/**
 * PRO-258 (D-087, tarea 6 del «Menú inteligente», 3C) — la semana se piensa
 * el sábado por la noche, por lotes, y el domingo por la mañana cada hogar
 * tiene la semana siguiente pensada. Mientras PRO-257 no se encienda, corre
 * a la sombra: nada de lo que hace llega al hogar.
 *
 * - **Cuándo:** el sábado desde las 21:00 de Madrid (`WEEKLY_PLAN_HOUR`), una
 *   vez por semana (`menu_planner_runs`, única por semana; se reclama antes
 *   de llamar a Anthropic). Los resultados se recogen en los ticks
 *   siguientes del programador (cada 5 min) cuando el lote termina (como
 *   mucho 24 h; normalmente minutos).
 * - **Qué hogares:** los mismos que el refinador de la ficha (plan activo,
 *   prueba o beta; ni pausados ni con el titular suspendido), con el titular
 *   por debajo de su tope de IA y con algún menú en las 3 últimas semanas.
 * - **Qué manda:** por hogar, la semana que haría hoy el generador (o la que
 *   ya tenga creada para esa semana), sus candidatas y el mismo prompt que
 *   el planificador al momento (PRO-255), en un Message Batch a mitad de
 *   precio. Cada resultado pasa el mismo comprobador y se guarda en
 *   `menu_planner_run_items`, con su coste en `cost_events` (`menu_planner`,
 *   al 50 %).
 * - En el alta y al rehacer la semana sigue pensándose en el momento
 *   (PRO-255); «Mimo está pensando tu semana» llega con PRO-257.
 */
import { and, desc, eq, gte, or } from 'drizzle-orm'
import type { DayMenu, Meal, Season } from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { menuPlannerRunItems, menuPlannerRuns, menus } from '../db/schema.js'
import { addDays, madridParts, mondayOf } from './madridTime.js'
import { loadMatchableRecipes } from './matchableRecipes.js'
import { generateMenu } from './menuGenerator.js'
import { PLANNER_MODEL, type PlannerCandidate, type PlannerRecipe, type PlannerSlotRequest } from './menuPlanner.js'
import { buildPlannerRequest, finishPlan, loadShadowContext, shadowPlannerEnabled, type CheckableContext, type PlannerCall } from './menuPlannerShadow.js'
import { BATCH_PRICE_FACTOR, anthropicBatchClient, listRefinerCandidates, refinerEligibility, type BatchResultLike, type RefinerBatchClient, type RefinerCandidate } from './profile/refiner.js'
import { loadPreviousWeek } from './menuWeek.js'
import { spendCapStatus } from './spendCap.js'

type Db = typeof defaultDb

/** Saturday (0 = Monday) from 21:00 Madrid. */
export const WEEKLY_PLAN_WEEKDAY = 5
export const WEEKLY_PLAN_HOUR = 21
/** A household with no menu in this many days before the target week is left out. */
export const WEEKLY_PLAN_ACTIVE_DAYS = 21

export type WeeklySkipReason = 'paused' | 'not_subscribed' | 'suspended' | 'spend_cap' | 'inactive' | 'no_slots' | 'no_candidates' | 'error'

/** Pure: is it time to send the Saturday batch, and for which week (the Monday after)? */
export function weeklyPlanDue(now: Date): { due: boolean; weekStart: string } {
  const p = madridParts(now)
  const weekStart = mondayOf(p.isoDate, p.weekday, 1)
  return { due: (p.weekday === WEEKLY_PLAN_WEEKDAY && p.hour >= WEEKLY_PLAN_HOUR) || (p.weekday === 6 && p.hour < 9), weekStart }
}

// ─── What is stored with each household until the result arrives ──

export interface StoredContext {
  generatorDays: DayMenu[]
  slots: PlannerSlotRequest[]
  candidates: Array<{ ref: string; recipeId: string; meals: Meal[] }>
  restrictions: string[]
  dislikes: string[]
  availableEquipment: string[] | null
  unavailableEquipment: string[] | null
  fixedRecipeIds: string[]
  bannedRecipeIds: string[]
  lightDinners: boolean
  season: Season
}

/** Pure: a prepared context → what is stored (recipe ids, never the recipes). */
export function toStoredContext(ctx: CheckableContext, generatorDays: DayMenu[], banned: Set<string>): StoredContext {
  return {
    generatorDays,
    slots: ctx.slots,
    candidates: ctx.candidates.map((c) => ({ ref: c.ref, recipeId: c.recipe.id, meals: c.meals })),
    restrictions: ctx.restrictions,
    dislikes: ctx.dislikes,
    availableEquipment: ctx.availableEquipment ? [...ctx.availableEquipment] : null,
    unavailableEquipment: ctx.unavailableEquipment ? [...ctx.unavailableEquipment] : null,
    fixedRecipeIds: [...ctx.fixedRecipeIds],
    bannedRecipeIds: [...banned],
    lightDinners: ctx.lightDinners,
    season: ctx.season,
  }
}

/** Pure: back to what the checker needs, with today's recipes (a recipe deleted meanwhile is no longer a candidate). */
export function fromStoredContext(stored: StoredContext, recipes: PlannerRecipe[], householdId: string): CheckableContext {
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const candidates: PlannerCandidate[] = stored.candidates.flatMap((c) => {
    const recipe = byId.get(c.recipeId)
    return recipe ? [{ ref: c.ref, recipe, meals: c.meals, score: 0, daysSinceEaten: null, atHome: [], opinion: null }] : []
  })
  return {
    householdId,
    recipes,
    candidates,
    slots: stored.slots,
    restrictions: stored.restrictions,
    dislikes: stored.dislikes,
    availableEquipment: stored.availableEquipment ? new Set(stored.availableEquipment) : undefined,
    unavailableEquipment: stored.unavailableEquipment ? new Set(stored.unavailableEquipment) : undefined,
    fixedRecipeIds: new Set(stored.fixedRecipeIds),
    lightDinners: stored.lightDinners,
    season: stored.season,
  }
}

// ─── Store and deps (fakes in tests) ────────────────────────────

export interface WeeklyItemRow {
  id: string
  householdId: string
  userId: string
  context: StoredContext
}

export interface WeeklyStore {
  runExists(weekStart: string): Promise<boolean>
  /** Insert the run row; null when another tick already claimed the week. */
  claimRun(weekStart: string, values: { status: 'empty' | 'submitted'; requested: number; skipped: Partial<Record<WeeklySkipReason, number>>; endedAt?: Date }): Promise<string | null>
  setBatch(runId: string, batchId: string): Promise<void>
  failRun(runId: string, error: string, now: Date): Promise<void>
  insertItems(runId: string, items: Array<{ householdId: string; userId: string; context: StoredContext }>): Promise<void>
  submittedRuns(): Promise<Array<{ id: string; weekStart: string; batchId: string | null }>>
  pendingItems(runId: string): Promise<WeeklyItemRow[]>
  completeItem(id: string, values: Record<string, unknown>): Promise<void>
  endRun(runId: string, now: Date): Promise<void>
}

export type PrepareResult =
  | { ok: true; ctx: CheckableContext & { prompt: string }; generatorDays: DayMenu[]; banned: Set<string> }
  | { ok: false; reason: WeeklySkipReason }

export interface WeeklyDeps {
  store: WeeklyStore
  batch: RefinerBatchClient
  listCandidates: () => Promise<RefinerCandidate[]>
  capExceeded: (userId: string) => Promise<boolean>
  /** Has the household had a menu in the `WEEKLY_PLAN_ACTIVE_DAYS` before `weekStart`? */
  isActive: (c: RefinerCandidate, weekStart: string) => Promise<boolean>
  prepare: (c: RefinerCandidate, weekStart: string) => Promise<PrepareResult>
  rebuild: (item: WeeklyItemRow) => Promise<CheckableContext>
}

export interface WeeklySubmitResult {
  weekStart: string
  status: 'empty' | 'submitted' | 'failed' | 'already'
  requested: number
  skipped: Partial<Record<WeeklySkipReason, number>>
  batchId?: string
  error?: string
}

/** Send Saturday's batch for `weekStart` (once). */
export async function submitWeeklyPlans(weekStart: string, now: Date, deps: WeeklyDeps): Promise<WeeklySubmitResult> {
  if (await deps.store.runExists(weekStart)) return { weekStart, status: 'already', requested: 0, skipped: {} }
  const skipped: Partial<Record<WeeklySkipReason, number>> = {}
  const skip = (r: WeeklySkipReason) => { skipped[r] = (skipped[r] ?? 0) + 1 }
  const selected: Array<{ c: RefinerCandidate; prepared: Extract<PrepareResult, { ok: true }> }> = []
  for (const c of await deps.listCandidates()) {
    const elig = refinerEligibility({ now, subscriptionStatus: c.subscriptionStatus, ownerSuspended: c.ownerSuspended })
    if (!elig.ok) { skip(elig.reason as WeeklySkipReason); continue }
    if (!(await deps.isActive(c, weekStart))) { skip('inactive'); continue }
    if (await deps.capExceeded(c.ownerId)) { skip('spend_cap'); continue }
    let prepared: PrepareResult
    try {
      prepared = await deps.prepare(c, weekStart)
    } catch (err) {
      console.warn(`[menuPlannerWeekly] ${c.householdId}: could not prepare the week:`, (err as Error)?.message ?? err)
      prepared = { ok: false, reason: 'error' }
    }
    if (!prepared.ok) { skip(prepared.reason); continue }
    selected.push({ c, prepared })
  }
  if (!selected.length) {
    await deps.store.claimRun(weekStart, { status: 'empty', requested: 0, skipped, endedAt: now })
    return { weekStart, status: 'empty', requested: 0, skipped }
  }
  const runId = await deps.store.claimRun(weekStart, { status: 'submitted', requested: selected.length, skipped })
  if (!runId) return { weekStart, status: 'already', requested: 0, skipped: {} }
  try {
    const batch = await deps.batch.create(selected.map((s) => ({ custom_id: s.c.householdId, params: buildPlannerRequest(s.prepared.ctx.prompt) })))
    await deps.store.setBatch(runId, batch.id)
    await deps.store.insertItems(runId, selected.map((s) => ({
      householdId: s.c.householdId,
      userId: s.c.ownerId,
      context: toStoredContext(s.prepared.ctx, s.prepared.generatorDays, s.prepared.banned),
    })))
    return { weekStart, status: 'submitted', requested: selected.length, skipped, batchId: batch.id }
  } catch (err) {
    const error = String((err as Error)?.message ?? err).slice(0, 500)
    await deps.store.failRun(runId, error, now)
    return { weekStart, status: 'failed', requested: selected.length, skipped, error }
  }
}

/** Collect every submitted run whose batch has ended. Returns how many households got their week. */
export async function collectWeeklyPlans(now: Date, deps: Pick<WeeklyDeps, 'store' | 'batch' | 'rebuild'>): Promise<number> {
  let processed = 0
  for (const run of await deps.store.submittedRuns()) {
    if (!run.batchId) continue
    if ((await deps.batch.status(run.batchId)) !== 'ended') continue
    const byHousehold = new Map((await deps.store.pendingItems(run.id)).map((i) => [i.householdId, i]))
    for await (const res of await deps.batch.results(run.batchId)) {
      const item = byHousehold.get(res.custom_id)
      if (!item) continue
      byHousehold.delete(res.custom_id)
      await deps.store.completeItem(item.id, await weeklyItemOutcome(item, res.result, deps.rebuild, now))
      processed++
    }
    for (const item of byHousehold.values()) {
      await deps.store.completeItem(item.id, { status: 'failed', errorMessage: 'Sin resultado en el lote', completedAt: now })
    }
    await deps.store.endRun(run.id, now)
  }
  return processed
}

/** One household's result → the values of its row (cost recorded at the batch price). */
export async function weeklyItemOutcome(item: WeeklyItemRow, result: BatchResultLike['result'], rebuild: WeeklyDeps['rebuild'], now: Date): Promise<Record<string, unknown>> {
  if (result.type !== 'succeeded') return { status: 'failed', errorMessage: `Resultado del lote: ${result.type}`, completedAt: now }
  try {
    const ctx = await rebuild(item)
    const banned = new Set(item.context.bannedRecipeIds)
    const plan = finishPlan(result.message as Awaited<ReturnType<PlannerCall>>, ctx, item.context.generatorDays, banned, { userId: item.userId, priceFactor: BATCH_PRICE_FACTOR })
    return {
      status: plan.status,
      errorMessage: plan.reason ?? null,
      days: plan.days ?? null,
      slots: plan.slots ?? [],
      check: plan.check ?? null,
      plannerScore: plan.plannerScore ?? null,
      generatorScore: plan.generatorScore ?? null,
      inputTokens: plan.inputTokens ?? null,
      outputTokens: plan.outputTokens ?? null,
      costMicros: plan.costMicros ?? null,
      completedAt: now,
    }
  } catch (err) {
    return { status: 'failed', errorMessage: String((err as Error)?.message ?? err).slice(0, 500), completedAt: now }
  }
}

// ─── Real store and deps ────────────────────────────────────────

export function dbWeeklyStore(db: Db = defaultDb): WeeklyStore {
  return {
    async runExists(weekStart) {
      const [r] = await db.select({ id: menuPlannerRuns.id }).from(menuPlannerRuns).where(eq(menuPlannerRuns.weekStart, weekStart)).limit(1)
      return !!r
    },
    async claimRun(weekStart, v) {
      const [r] = await db.insert(menuPlannerRuns)
        .values({ weekStart, status: v.status, model: PLANNER_MODEL, requested: v.requested, skipped: v.skipped, endedAt: v.endedAt ?? null })
        .onConflictDoNothing().returning({ id: menuPlannerRuns.id })
      return r?.id ?? null
    },
    async setBatch(runId, batchId) {
      await db.update(menuPlannerRuns).set({ batchId }).where(eq(menuPlannerRuns.id, runId))
    },
    async failRun(runId, error, now) {
      await db.update(menuPlannerRuns).set({ status: 'failed', errorMessage: error, endedAt: now }).where(eq(menuPlannerRuns.id, runId))
    },
    async insertItems(runId, items) {
      if (items.length) await db.insert(menuPlannerRunItems).values(items.map((i) => ({ runId, ...i })))
    },
    async submittedRuns() {
      return db.select({ id: menuPlannerRuns.id, weekStart: menuPlannerRuns.weekStart, batchId: menuPlannerRuns.batchId }).from(menuPlannerRuns).where(eq(menuPlannerRuns.status, 'submitted'))
    },
    async pendingItems(runId) {
      const rows = await db.select().from(menuPlannerRunItems).where(and(eq(menuPlannerRunItems.runId, runId), eq(menuPlannerRunItems.status, 'pending')))
      return rows.map((r) => ({ id: r.id, householdId: r.householdId, userId: r.userId, context: r.context as StoredContext }))
    },
    async completeItem(id, values) {
      await db.update(menuPlannerRunItems).set(values as any).where(eq(menuPlannerRunItems.id, id))
    },
    async endRun(runId, now) {
      await db.update(menuPlannerRuns).set({ status: 'ended', endedAt: now }).where(eq(menuPlannerRuns.id, runId))
    },
  }
}

export function defaultWeeklyDeps(db: Db = defaultDb): WeeklyDeps {
  return {
    store: dbWeeklyStore(db),
    batch: anthropicBatchClient,
    listCandidates: () => listRefinerCandidates(db),
    capExceeded: async (userId) => (await spendCapStatus(userId, { db })).exceeded,
    async isActive(c, weekStart) {
      const [m] = await db.select({ id: menus.id }).from(menus)
        .where(and(or(eq(menus.householdId, c.householdId), eq(menus.userId, c.ownerId)), gte(menus.weekStart, addDays(weekStart, -WEEKLY_PLAN_ACTIVE_DAYS))))
        .limit(1)
      return !!m
    },
    async prepare(c, weekStart) {
      // The week as the generator would make it today — or the one the household already has.
      const [existing] = await db.select({ days: menus.days }).from(menus)
        .where(and(eq(menus.userId, c.ownerId), eq(menus.weekStart, weekStart))).orderBy(desc(menus.createdAt)).limit(1)
      const previous = await loadPreviousWeek(c.ownerId, weekStart, db)
      const generatorDays = Array.isArray(existing?.days) && (existing!.days as DayMenu[]).length
        ? (existing!.days as DayMenu[])
        : (await generateMenu(c.ownerId, weekStart, undefined, db, previous.locked, previous.days, previous.bannedRecipeIds, previous.skippedDays)).days
      const ctx = await loadShadowContext({ menuId: '', userId: c.ownerId, weekStart, days: generatorDays, locked: previous.locked, bannedRecipeIds: previous.bannedRecipeIds, skippedDays: previous.skippedDays }, db)
      if (!ctx.slots.length) return { ok: false, reason: 'no_slots' }
      if (!ctx.candidates.length) return { ok: false, reason: 'no_candidates' }
      return { ok: true, ctx, generatorDays, banned: previous.bannedRecipeIds }
    },
    async rebuild(item) {
      const recipes = (await loadMatchableRecipes(item.userId, db)) as PlannerRecipe[]
      return fromStoredContext(item.context, recipes, item.householdId)
    },
  }
}

/** From the scheduler tick: on Saturday night send the batch for next week (once); on every tick, collect ended batches. */
export async function runWeeklyPlannerIfDue(now: Date = new Date(), deps?: WeeklyDeps): Promise<{ submit: WeeklySubmitResult | null; collected: number } | null> {
  if (!deps && (!env.ANTHROPIC_API_KEY || !shadowPlannerEnabled())) return null
  const d = deps ?? defaultWeeklyDeps()
  const { due, weekStart } = weeklyPlanDue(now)
  const submit = due ? await submitWeeklyPlans(weekStart, now, d) : null
  const collected = await collectWeeklyPlans(now, d)
  return { submit: submit?.status === 'already' ? null : submit, collected }
}

