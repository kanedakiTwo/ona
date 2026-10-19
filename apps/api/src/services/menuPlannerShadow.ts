/**
 * PRO-255 — Mimo piensa la semana, **a la sombra**: corre al lado del
 * generador de hoy cada vez que se genera un menú (POST /menu/generate y la
 * herramienta de Mimo `generate_weekly_menu`), guarda su propuesta, lo que
 * dijo el comprobador y su coste en `menu_plans`, y el hogar sigue viendo el
 * menú del generador. La parte pura está en `menuPlanner.ts`.
 *
 * - Una llamada a Claude Opus 5.5 (D-070) con razonamiento adaptativo y el
 *   formato cerrado `PLANNER_OUTPUT_SCHEMA`; su coste va a `cost_events`
 *   (`menu_planner`) a cargo del usuario y cuenta para su tope mensual.
 * - Sin clave de Anthropic, con el tope gastado, sin huecos o sin
 *   candidatas: fila `skipped` con el motivo; un error, un corte o un
 *   formato roto: fila `fallback`. Nunca rompe ni retrasa el menú: se lanza
 *   sin esperar (`startShadowPlan`).
 * - `MENU_PLANNER_SHADOW=off` lo apaga.
 */
import Anthropic from '@anthropic-ai/sdk'
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import { buildMemoryDigestText, detectSeason, type DayMenu, type LockedSlots } from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { menuEdits, menuPlans, menus, pantryItems, userFavorites, users, userSettings } from '../db/schema.js'
import { recordCost, anthropicUnits, type AnthropicUsageLike } from './costLedger.js'
import { computeCostMicros } from '../config/pricing.js'
import { mergeRestrictions } from './dietaryRestrictions.js'
import { loadHouseholdRatingSets } from './householdRatings.js'
import { loadMatchableRecipes } from './matchableRecipes.js'
import { extractMealDiners } from './menuGenerator.js'
import {
  PLANNER_EFFORT,
  PLANNER_FEATURE,
  PLANNER_MAX_TOKENS,
  PLANNER_MODEL,
  PLANNER_OUTPUT_SCHEMA,
  PLANNER_SYSTEM_PROMPT,
  PLANNER_TIMEOUT_MS,
  buildPlannerCandidates,
  buildPlannerPrompt,
  checkPlan,
  mergeWithGenerator,
  parsePlannerMessage,
  slotsToPlan,
  type PlannerCandidate,
  type PlannerRecipe,
  type PlanCheck,
} from './menuPlanner.js'
import { weekTimeBudgets } from './onboardingPreferences.js'
import { buildFichaDigest, fichaMenuConstraints, loadHouseholdFicha, withFichaFilters } from './profile/reader.js'
import { normaliseEquipment } from './recipeMatcher.js'
import { resolveScope, scopeWhere, getPrimaryHouseholdId } from './scopeResolver.js'
import { spendCapStatus } from './spendCap.js'
import { getMemoryForUser } from './userMemoryStore.js'
import { asksLightDinners, scoreWeek, type WeekRecipe } from './weekRules.js'

type Db = typeof defaultDb

const DAY = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MEAL_LABEL: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }

export interface ShadowPlanInput {
  menuId: string
  userId: string
  weekStart: string
  /** The generator's week, as saved. */
  days: DayMenu[]
  locked?: LockedSlots
  bannedRecipeIds?: Set<string>
  skippedDays?: Set<number>
}

export type PlannerCall = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<{
  content: Array<{ type: string; text?: string }>
  stop_reason: string | null
  usage?: AnthropicUsageLike | null
}>

export interface ShadowDeps {
  db: Db
  /** null = no API key. */
  call: PlannerCall | null
  capExceeded: (userId: string) => Promise<boolean>
  now: () => Date
  timeoutMs: number
}

let testCall: PlannerCall | null | undefined
/** Test seam: a fake model (null = «no key»; undefined restores the real one). */
export function setPlannerCallForTests(fake: PlannerCall | null | undefined): void {
  testCall = fake
}

export function defaultShadowDeps(db: Db = defaultDb): ShadowDeps {
  let call: PlannerCall | null = null
  if (testCall !== undefined) call = testCall
  else if (env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    call = (p) => client.messages.create(p) as any
  }
  return {
    db,
    call,
    capExceeded: async (userId) => (await spendCapStatus(userId, { db })).exceeded,
    now: () => new Date(),
    timeoutMs: PLANNER_TIMEOUT_MS,
  }
}

export function shadowPlannerEnabled(): boolean {
  return (process.env.MENU_PLANNER_SHADOW ?? 'on').toLowerCase() !== 'off'
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

// ─── Context ────────────────────────────────────────────────────

export interface ShadowContext {
  householdId: string | null
  recipes: PlannerRecipe[]
  candidates: PlannerCandidate[]
  restrictions: string[]
  dislikes: string[]
  availableEquipment?: Set<string>
  unavailableEquipment?: Set<string>
  prompt: string
  slots: ReturnType<typeof slotsToPlan>
  lightDinners: boolean
  fixedRecipeIds: Set<string>
  season: ReturnType<typeof detectSeason>
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Everything the planner reads for one menu. */
export async function loadShadowContext(input: ShadowPlanInput, db: Db): Promise<ShadowContext> {
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1)
  if (!user) throw new Error('user not found')
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, input.userId)).limit(1)
  const householdId = await getPrimaryHouseholdId(input.userId, db)
  const memory = await getMemoryForUser(input.userId).catch(() => ({}) as Awaited<ReturnType<typeof getMemoryForUser>>)
  const ficha = await loadHouseholdFicha(input.userId, { db }).catch(() => null)
  const season = detectSeason()

  const restrictions = mergeRestrictions(user.restrictions, memory)
  const dislikesValue = (memory as any)?.dislikes?.value
  const equipmentValue = (memory as any)?.equipment?.value
  const filters = withFichaFilters(
    {
      dislikes: Array.isArray(dislikesValue) ? dislikesValue : [],
      availableEquipment: Array.isArray(equipmentValue) ? new Set<string>(equipmentValue.map((e: string) => normaliseEquipment(e))) : undefined,
    },
    fichaMenuConstraints(ficha),
  )

  const recipes = (await loadMatchableRecipes(input.userId, db)) as PlannerRecipe[]
  const recipesById = new Map(recipes.map((r) => [r.id, r]))

  // The 3 weeks before: what was in the menu, and what the household changed.
  const scope = await resolveScope(input.userId, db)
  const from = addDays(input.weekStart, -21)
  const earlier = await db.select({ id: menus.id, weekStart: menus.weekStart, days: menus.days, createdAt: menus.createdAt }).from(menus)
    .where(and(scopeWhere(menus.userId, menus.householdId, scope), gte(menus.weekStart, from), lt(menus.weekStart, input.weekStart)))
    .orderBy(desc(menus.createdAt))
  const latestByWeek = new Map<string, (typeof earlier)[number]>()
  for (const m of earlier) if (!latestByWeek.has(String(m.weekStart))) latestByWeek.set(String(m.weekStart), m)
  const weeks = [...latestByWeek.values()].sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)))
  const daysSinceEaten = new Map<string, number>()
  const previousWeeks: string[] = []
  for (const w of weeks) {
    const lines: string[] = []
    ;((w.days as DayMenu[]) ?? []).forEach((day, d) => {
      for (const meal of ['lunch', 'dinner']) {
        const names = (day?.[meal]?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeName ?? recipesById.get(x.recipeId)?.name ?? '?'] : x.kind === 'note' ? [`«${x.text}»`] : []))
        if (names.length) lines.push(`${DAY[d]} ${MEAL_LABEL[meal]}: ${names.join(' + ')}`)
        for (const x of day?.[meal]?.dishes ?? []) {
          if (x.kind !== 'recipe') continue
          const ago = Math.round((Date.parse(`${input.weekStart}T12:00:00Z`) - Date.parse(`${addDays(String(w.weekStart), d)}T12:00:00Z`)) / 86_400_000)
          daysSinceEaten.set(x.recipeId, Math.min(daysSinceEaten.get(x.recipeId) ?? Infinity, ago))
        }
      }
    })
    previousWeeks.push(`${w.weekStart} · ${lines.join('; ') || '(vacía)'}`)
  }
  const menuIds = earlier.map((m) => m.id)
  const editRows = menuIds.length
    ? await db.select().from(menuEdits).where(inArray(menuEdits.menuId, menuIds)).orderBy(menuEdits.createdAt).limit(200)
    : []
  const rejectedCounts = new Map<string, number>()
  const edits: string[] = []
  for (const e of editRows) {
    if (['swap', 'remove', 'ban'].includes(e.action) && e.beforeRecipeId) rejectedCounts.set(e.beforeRecipeId, (rejectedCounts.get(e.beforeRecipeId) ?? 0) + 1)
    const where = e.day != null ? `${DAY[e.day]}${e.meal ? ` ${MEAL_LABEL[e.meal] ?? e.meal}` : ''}` : 'semana'
    if (e.action === 'swap') edits.push(`${where}: «${e.beforeRecipeName ?? '?'}» → «${e.afterRecipeName ?? '?'}»`)
    else if (e.action === 'ban') edits.push(`veta «${e.beforeRecipeName ?? '?'}»`)
    else if (e.action === 'remove') edits.push(`${where}: quita «${e.beforeRecipeName ?? '?'}»`)
    else if (e.action === 'skip_day') edits.push(`${where}: sin cocinar`)
    else if (e.action === 'add') edits.push(`${where}: añade «${e.afterRecipeName ?? '?'}»`)
  }

  const favScope = scope
  const favRows = await db.select({ recipeId: userFavorites.recipeId }).from(userFavorites)
    .where(scopeWhere(userFavorites.userId, userFavorites.householdId, favScope))
  const ratings = await loadHouseholdRatingSets(input.userId, db).catch(() => ({ boost: new Set<string>(), exclude: new Set<string>(), like: new Set<string>() }))
  const pantry = householdId
    ? await db.select({ ingredientId: pantryItems.ingredientId }).from(pantryItems).where(eq(pantryItems.householdId, householdId))
    : []
  const banned = new Set([...(input.bannedRecipeIds ?? []), ...ratings.exclude])

  const candidates = buildPlannerCandidates(recipes, {
    season,
    restrictions,
    dislikes: filters.dislikes,
    availableEquipment: filters.availableEquipment,
    unavailableEquipment: filters.unavailableEquipment,
    bannedRecipeIds: banned,
  }, {
    favoriteRecipeIds: new Set(favRows.map((f) => f.recipeId)),
    lovedRecipeIds: ratings.boost,
    likedRecipeIds: ratings.like,
    daysSinceEaten,
    rejectedCounts,
    pantryIngredientIds: new Set(pantry.map((p) => p.ingredientId).filter((x): x is string => !!x)),
  })

  const rawTemplate = settings?.template
  const slots = slotsToPlan(input.days, {
    locked: input.locked as Record<string, Record<string, boolean>> | undefined,
    skippedDays: input.skippedDays,
    mealDiners: extractMealDiners(rawTemplate),
    timeBudgetByDay: weekTimeBudgets((memory as any)?.time_available?.value, user),
  })
  const planned = new Set(slots.map((s) => `${s.dayIndex}|${s.meal}`))
  const fixedRecipeIds = new Set<string>()
  input.days.forEach((day, d) => {
    for (const meal of Object.keys(day ?? {})) {
      if (planned.has(`${d}|${meal}`)) continue
      for (const x of day[meal]?.dishes ?? []) if (x.kind === 'recipe' && x.variant !== 'leftover' && x.variant !== 'freezer') fixedRecipeIds.add(x.recipeId)
    }
  })

  const memoryDigest = buildMemoryDigestText(memory as any)
  const lightDinners = asksLightDinners([
    memoryDigest,
    ...(ficha?.facts ?? []).flatMap((f) => (Array.isArray(f.value) ? f.value.map(String) : typeof (f.value as any)?.description === 'string' ? [(f.value as any).description] : [])),
    ficha?.portrait ?? '',
    user.onboardingNote ?? '',
  ])

  return {
    householdId,
    recipes,
    candidates,
    restrictions,
    dislikes: filters.dislikes,
    availableEquipment: filters.availableEquipment,
    unavailableEquipment: filters.unavailableEquipment,
    slots,
    lightDinners,
    fixedRecipeIds,
    season,
    prompt: buildPlannerPrompt({
      weekStart: input.weekStart,
      season,
      slots,
      candidates,
      fichaDigest: buildFichaDigest(ficha, input.userId),
      memoryDigest,
      previousWeeks,
      edits,
      lightDinners,
    }),
  }
}

// ─── Run ────────────────────────────────────────────────────────

export interface ShadowPlanRow {
  menuId: string
  userId: string
  householdId: string | null
  status: 'ok' | 'partial' | 'fallback' | 'skipped'
  reason: string | null
  days: DayMenu[] | null
  slots: unknown[]
  check: unknown
  plannerScore: unknown
  generatorScore: unknown
  candidates: number
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  costMicros: number | null
  durationMs: number
}

/** Pure: the request sent to Claude. */
export function buildPlannerRequest(prompt: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: PLANNER_MODEL,
    max_tokens: PLANNER_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: PLANNER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: PLANNER_EFFORT, format: { type: 'json_schema', schema: PLANNER_OUTPUT_SCHEMA as any } },
  } as Anthropic.MessageCreateParamsNonStreaming
}

const scoreOf = (days: DayMenu[], recipes: PlannerRecipe[], ctx: Pick<ShadowContext, 'season' | 'lightDinners'>) =>
  scoreWeek(days, new Map(recipes.map((r) => [r.id, r as WeekRecipe])), { season: ctx.season, lightDinners: ctx.lightDinners })

/** What the checker needs of a context (a live one, or one rebuilt after a batch, PRO-258). */
export type CheckableContext = Pick<ShadowContext, 'householdId' | 'recipes' | 'candidates' | 'slots' | 'restrictions' | 'dislikes' | 'availableEquipment' | 'unavailableEquipment' | 'fixedRecipeIds' | 'season' | 'lightDinners'>

/**
 * Claude's answer → the row's plan: cost recorded (to the user and the
 * household; `priceFactor` 0.5 for a batch), the answer checked and merged
 * with the generator's week, both weeks scored.
 */
export function finishPlan(
  message: Awaited<ReturnType<PlannerCall>>,
  ctx: CheckableContext,
  generatorDays: DayMenu[],
  bannedRecipeIds: Set<string> | undefined,
  opts: { userId: string; priceFactor?: number },
): Partial<ShadowPlanRow> {
  const factor = opts.priceFactor ?? 1
  const units = message.usage ? anthropicUnits(message.usage) : null
  if (units) {
    recordCost({ feature: PLANNER_FEATURE, provider: 'anthropic', model: PLANNER_MODEL, units, userId: opts.userId, householdId: ctx.householdId, priceFactor: factor })
  }
  const list = units ? computeCostMicros('anthropic', PLANNER_MODEL, units) : null
  const usage = {
    model: PLANNER_MODEL,
    inputTokens: units?.inputTokens ?? null,
    outputTokens: units?.outputTokens ?? null,
    costMicros: list === null ? null : Math.round(list * factor),
    generatorScore: scoreOf(generatorDays, ctx.recipes, ctx),
    candidates: ctx.candidates.length,
    householdId: ctx.householdId,
  }
  const output = parsePlannerMessage(message)
  if (!output) return { ...usage, status: 'fallback', reason: message.stop_reason === 'refusal' ? 'refusal' : 'invalid', days: generatorDays }
  const check: PlanCheck = checkPlan(output, {
    slots: ctx.slots,
    candidates: ctx.candidates,
    recipesById: new Map(ctx.recipes.map((r) => [r.id, r])),
    restrictions: ctx.restrictions,
    dislikes: ctx.dislikes,
    bannedRecipeIds,
    availableEquipment: ctx.availableEquipment,
    unavailableEquipment: ctx.unavailableEquipment,
    fixedRecipeIds: ctx.fixedRecipeIds,
  })
  const merged = mergeWithGenerator(generatorDays, check)
  return {
    ...usage,
    status: merged.status,
    reason: merged.status === 'fallback' ? 'all_slots_failed' : null,
    days: merged.days,
    slots: check.slots.map((s) => ({ ...s, source: s.problems.length || !s.recipeId ? 'generator' : 'planner' })),
    check: { ok: check.ok, problems: check.problems, extra: check.extra },
    plannerScore: scoreOf(merged.days, ctx.recipes, ctx),
  }
}

/**
 * Plan one menu in the shadow and return the row to store. Never throws:
 * any failure becomes a `fallback` / `skipped` row.
 */
export async function planMenuInShadow(input: ShadowPlanInput, deps: ShadowDeps, loadContext: typeof loadShadowContext = loadShadowContext): Promise<ShadowPlanRow> {
  const started = deps.now().getTime()
  const base: ShadowPlanRow = {
    menuId: input.menuId, userId: input.userId, householdId: null, status: 'skipped', reason: null, days: null, slots: [], check: null,
    plannerScore: null, generatorScore: null, candidates: 0, model: null, inputTokens: null, outputTokens: null, costMicros: null, durationMs: 0,
  }
  const done = (row: Partial<ShadowPlanRow>): ShadowPlanRow => ({ ...base, ...row, durationMs: deps.now().getTime() - started })
  if (!deps.call) return done({ reason: 'no_key' })
  try {
    if (await deps.capExceeded(input.userId)) return done({ reason: 'spend_cap' })
    const ctx = await loadContext(input, deps.db)
    base.householdId = ctx.householdId
    base.candidates = ctx.candidates.length
    base.generatorScore = scoreOf(input.days, ctx.recipes, ctx)
    if (!ctx.slots.length) return done({ reason: 'no_slots' })
    if (!ctx.candidates.length) return done({ reason: 'no_candidates' })

    const message = await withTimeout(deps.call(buildPlannerRequest(ctx.prompt)), deps.timeoutMs)
    return done(finishPlan(message, ctx, input.days, input.bannedRecipeIds, { userId: input.userId }))
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    console.warn('[menuPlanner] shadow plan failed (the menu is unaffected):', msg)
    return done({ status: 'fallback', reason: msg === 'timeout' ? 'timeout' : 'error', days: input.days })
  }
}

export async function saveShadowPlan(row: ShadowPlanRow, db: Db = defaultDb): Promise<void> {
  await db.insert(menuPlans).values({
    menuId: row.menuId,
    userId: row.userId,
    householdId: row.householdId,
    mode: 'shadow',
    status: row.status,
    reason: row.reason,
    days: row.days,
    slots: row.slots,
    check: row.check,
    plannerScore: row.plannerScore,
    generatorScore: row.generatorScore,
    candidates: row.candidates,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costMicros: row.costMicros,
    durationMs: row.durationMs,
  })
}

/** Fire and forget, from the places that generate a menu. Never awaited, never throws. */
export function startShadowPlan(input: ShadowPlanInput, deps?: ShadowDeps): void {
  if (!shadowPlannerEnabled()) return
  if (process.env.VITEST && !deps && testCall === undefined) return
  const d = deps ?? defaultShadowDeps()
  void planMenuInShadow(input, d)
    .then((row) => saveShadowPlan(row, d.db))
    .catch((err) => console.warn('[menuPlanner] could not save the shadow plan:', (err as Error)?.message ?? err))
}
