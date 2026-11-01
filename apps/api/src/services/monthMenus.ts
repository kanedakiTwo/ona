/**
 * PRO-378 · «Menú del mes» (idea de FuturApp, 2026-10-24/25).
 *
 * Cocina writes, once a month, a week of the house's dishes in a JSON file
 * (its «menus-del-mes» folder) and imports it from the admin
 * route (`POST /admin/month-menus`). It lives in `catalog_collections` with
 * `kind = 'menu_mes'` and its `month` (YYYY-MM). Households see it as a card
 * «Menú de <mes>» in `/recipes` and on the blank week of `/menu`, open it by
 * days (`/menu/mes`) and «Copiar a mi semana» writes its dishes in the week
 * they are looking at.
 *
 * The import is refused (every problem in Spanish) unless the week is a good
 * week by Cocina's own rules (`weekRules.ts`):
 *   - at least 5 days with lunch and dinner;
 *   - never fish or seafood at lunch and at dinner the same day (`isFishDish`);
 *   - nothing longer than 45 min from Monday to Friday (`recipeTotalMinutes`).
 *
 * The copy only fills the meals of the household's plantilla (a household
 * without breakfasts gets lunches and dinners), leaves its «sin cocinar» days
 * and locked slots alone, and a dish that breaks anyone's allergies or diet
 * is swapped for a similar one (same course, same main protein when there is
 * one) with `findForCourse`; the answer says how many were swapped.
 *
 * Spec: specs/menus.md → «Menú del mes»; specs/catalog-import.md.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { detectSeason, MEALS, recipeTotalMinutes, type Course, type DayMenu, type DayTemplate, type Meal, type RecipeDish } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { catalogCollections, menus, recipes, users, userSettings } from '../db/schema.js'
import { compileRestrictions, mergeRestrictions, normalizeText, violatesRestrictions, type RestrictableRecipe } from './dietaryRestrictions.js'
import { withHouseholdRestrictions } from './householdAllergies.js'
import { addDays, madridParts } from './madridTime.js'
import { loadMatchableRecipes, type RecipeWithCourse } from './matchableRecipes.js'
import { findForCourse } from './courseAwareMatcher.js'
import { getMemoryForUser } from './userMemoryStore.js'
import { isFishDish, mainProteinOf, type WeekRecipe } from './weekRules.js'
import { keepLockedSlots, loadPreviousWeek, menuHasDishes } from './menuWeek.js'
import { defaultTemplate, normalizeMealTemplate } from './menuGenerator.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'
import { isRetiredRecipe } from './recipeCatalogOrder.js'
import { enqueuePrepAlertsForMenu } from './notificationScheduler.js'

export const MONTH_MENU_KIND = 'menu_mes'

export const MONTH_MENU_RULES = {
  /** Days with lunch and dinner, at least. */
  minFullDays: 5,
  /** Monday to Friday, no dish longer than this (total minutes). */
  maxWeekdayMinutes: 45,
  /** Dishes per meal in the file, at most. */
  maxDishesPerMeal: 3,
}

/** 7 days, Monday first; per meal, the recipe ids in order. */
export type MonthMenuWeek = Array<Partial<Record<Meal, string[]>>>

export const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const
const MEAL_NAMES: Record<Meal, string> = { breakfast: 'desayuno', lunch: 'comida', dinner: 'cena', snack: 'merienda' }
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Keys a file may use for a meal (Spanish as Cocina writes them, or the app's). */
const MEAL_KEYS: Record<string, Meal> = {
  desayuno: 'breakfast',
  breakfast: 'breakfast',
  comida: 'lunch',
  almuerzo: 'lunch',
  lunch: 'lunch',
  merienda: 'snack',
  snack: 'snack',
  cena: 'dinner',
  dinner: 'dinner',
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * The file Cocina writes:
 *   { "month": "2026-11", "title"?: "Menú de noviembre",
 *     "days": { "lunes": { "comida": ["<id o nombre exacto>"], "cena": [...] }, … } }
 * A dish is a catalogue recipe's id or its exact name (accents and case aside).
 */
export const monthMenuFileSchema = z.object({
  month: z.string().regex(MONTH_RE, 'El mes va como AAAA-MM (p. ej. 2026-11).'),
  title: z.string().trim().min(1).max(80).optional(),
  days: z.record(z.record(z.array(z.string().trim().min(1).max(200)))),
})
export type MonthMenuFile = z.infer<typeof monthMenuFileSchema>

/** «Menú de noviembre» for `2026-11`. */
export function monthMenuTitle(month: string): string {
  const m = Number(month.slice(5, 7))
  return `Menú de ${MONTH_NAMES[m - 1] ?? month}`
}

/** YYYY-MM of `now` in Madrid. */
export function madridMonth(now: Date = new Date()): string {
  return madridParts(now).isoDate.slice(0, 7)
}

function slotLabel(day: number, meal: Meal): string {
  return `${DAY_NAMES[day]}, ${MEAL_NAMES[meal]}`
}

export interface ParsedMonthMenu {
  month: string
  title: string
  /** Per day and meal, the file's references (ids or names), not resolved yet. */
  refs: MonthMenuWeek
  problems: string[]
}

/** Pure: the file into 7 days of references, with what's wrong in Spanish. */
export function parseMonthMenuFile(raw: unknown): ParsedMonthMenu {
  const parsed = monthMenuFileSchema.safeParse(raw)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => {
      const where = i.path.length ? `${i.path.join(' → ')}: ` : ''
      return `${where}${i.message === 'Required' ? 'falta' : i.message}`
    })
    return { month: '', title: '', refs: [], problems }
  }
  const file = parsed.data
  const problems: string[] = []
  const refs: MonthMenuWeek = Array.from({ length: 7 }, () => ({}))
  const dayIndex = new Map(DAY_NAMES.map((d, i) => [normalizeText(d), i]))
  for (const [dayKey, meals] of Object.entries(file.days)) {
    const day = dayIndex.get(normalizeText(dayKey))
    if (day === undefined) {
      problems.push(`«${dayKey}» no es un día: usa lunes, martes, miércoles, jueves, viernes, sábado o domingo.`)
      continue
    }
    for (const [mealKey, dishes] of Object.entries(meals)) {
      const meal = MEAL_KEYS[normalizeText(mealKey)]
      if (!meal) {
        problems.push(`${DAY_NAMES[day]}: «${mealKey}» no es una comida; usa desayuno, comida, merienda o cena.`)
        continue
      }
      if (dishes.length > MONTH_MENU_RULES.maxDishesPerMeal) {
        problems.push(`${slotLabel(day, meal)}: como mucho ${MONTH_MENU_RULES.maxDishesPerMeal} platos.`)
        continue
      }
      if (dishes.length > 0) refs[day][meal] = dishes
    }
  }
  return { month: file.month, title: file.title ?? monthMenuTitle(file.month), refs, problems }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pure: references → catalogue recipe ids (by id, else by exact name). */
export function resolveMonthMenuRefs(
  refs: MonthMenuWeek,
  catalogue: ReadonlyArray<{ id: string; name: string }>,
): { week: MonthMenuWeek; problems: string[] } {
  const byId = new Set(catalogue.map((r) => r.id))
  const byName = new Map<string, string>()
  for (const r of catalogue) {
    const key = normalizeText(r.name)
    if (!byName.has(key)) byName.set(key, r.id)
  }
  const problems: string[] = []
  const week: MonthMenuWeek = refs.map((day, d) => {
    const out: Partial<Record<Meal, string[]>> = {}
    for (const meal of MEALS) {
      const list = day[meal]
      if (!list) continue
      const ids: string[] = []
      for (const ref of list) {
        const id = UUID_RE.test(ref) ? (byId.has(ref.toLowerCase()) ? ref.toLowerCase() : null) : byName.get(normalizeText(ref)) ?? null
        if (id) ids.push(id)
        else problems.push(`${slotLabel(d, meal)}: «${ref}» no está en el catálogo publicado.`)
      }
      if (ids.length) out[meal] = ids
    }
    return out
  })
  return { week, problems }
}

/** Pure: Cocina's rules for a month menu (see the header). Empty = it's a good week. */
export function checkMonthMenuRules(week: MonthMenuWeek, recipesById: ReadonlyMap<string, WeekRecipe>): string[] {
  const problems: string[] = []
  const name = (id: string) => recipesById.get(id)?.name ?? id
  const fullDays = week.filter((d) => (d.lunch?.length ?? 0) > 0 && (d.dinner?.length ?? 0) > 0).length
  if (fullDays < MONTH_MENU_RULES.minFullDays) {
    problems.push(`Hacen falta al menos ${MONTH_MENU_RULES.minFullDays} días con comida y cena (hay ${fullDays}).`)
  }
  week.forEach((day, d) => {
    const fishIn = (meal: Meal) => (day[meal] ?? []).find((id) => {
      const r = recipesById.get(id)
      return r ? isFishDish(r) : false
    })
    const lunchFish = fishIn('lunch')
    const dinnerFish = fishIn('dinner')
    if (lunchFish && dinnerFish) {
      problems.push(`${DAY_NAMES[d]}: pescado en la comida («${name(lunchFish)}») y en la cena («${name(dinnerFish)}»); el mismo día, solo en una.`)
    }
    if (d > 4) return
    for (const meal of MEALS) {
      for (const id of day[meal] ?? []) {
        const r = recipesById.get(id)
        const minutes = r ? recipeTotalMinutes(r) : null
        if (minutes != null && minutes > MONTH_MENU_RULES.maxWeekdayMinutes) {
          problems.push(`${slotLabel(d, meal)}: «${name(id)}» tarda ${minutes} min; entre semana, como mucho ${MONTH_MENU_RULES.maxWeekdayMinutes}.`)
        }
      }
    }
  })
  return problems
}

// ─── Copiar a mi semana (pure) ──────────────────────────────

/** A recipe as `loadMatchableRecipes` gives it: the rules and the restriction check read it. */
export type CopyRecipe = WeekRecipe & RestrictableRecipe & { ingredients: WeekRecipe['ingredients'] & RestrictableRecipe['ingredients']; course?: Course | null }

export interface CopyPickContext {
  day: number
  meal: Meal
  course: Course | null
  /** The month's dish being swapped (null when it's no longer in the catalogue). */
  original: CopyRecipe | null
  /** Every recipe already in the week (not to repeat). */
  usedRecipeIds: Set<string>
}

export interface CopySwap {
  day: number
  meal: Meal
  from: string
  to: string | null
}

export interface CopyMonthMenuInput {
  week: MonthMenuWeek
  /** The household's plantilla: which meals each day has. */
  template: DayTemplate[]
  /** «Sin cocinar» days: left without slots. */
  skippedDays?: ReadonlySet<number>
  recipesById: ReadonlyMap<string, CopyRecipe>
  /** Everyone's allergies and diets in the household. */
  restrictions: readonly string[]
  pick: (ctx: CopyPickContext) => { id: string; name: string; course?: Course | null } | null
}

export interface CopyMonthMenuResult {
  days: DayMenu[]
  /** Dishes written, swapped ones included. */
  copied: number
  /** Dishes swapped for a similar one (or dropped, `to: null`, when nothing fits). */
  swaps: CopySwap[]
}

/** Pure: the month's week as the household's week (see the header). */
export function copyMonthMenu(input: CopyMonthMenuInput): CopyMonthMenuResult {
  const rules = compileRestrictions(input.restrictions)
  const used = new Set<string>()
  for (const day of input.week) for (const ids of Object.values(day)) for (const id of ids ?? []) used.add(id)
  const swaps: CopySwap[] = []
  let copied = 0
  const days: DayMenu[] = Array.from({ length: 7 }, (_, d) => {
    const out: DayMenu = {}
    if (input.skippedDays?.has(d)) return out
    const tpl = (input.template[d] ?? {}) as Record<string, boolean | undefined>
    for (const meal of MEALS) {
      if (!tpl[meal]) continue
      const dishes: RecipeDish[] = []
      for (const id of input.week[d]?.[meal] ?? []) {
        const recipe = input.recipesById.get(id) ?? null
        if (recipe && !violatesRestrictions(recipe, rules)) {
          dishes.push({ kind: 'recipe', recipeId: recipe.id, recipeName: recipe.name, course: recipe.course ?? null })
          copied++
          continue
        }
        used.delete(id)
        const picked = input.pick({ day: d, meal, course: recipe?.course ?? null, original: recipe, usedRecipeIds: used })
        swaps.push({ day: d, meal, from: recipe?.name ?? 'Un plato', to: picked?.name ?? null })
        if (!picked) continue
        used.add(picked.id)
        dishes.push({ kind: 'recipe', recipeId: picked.id, recipeName: picked.name, course: picked.course ?? null })
        copied++
      }
      out[meal] = { dishes }
    }
    return out
  })
  return { days, copied, swaps }
}

/** Pure: the notice after copying. */
export function copyNotice(result: Pick<CopyMonthMenuResult, 'copied' | 'swaps'>): string {
  const swapped = result.swaps.filter((s) => s.to).length
  const dropped = result.swaps.length - swapped
  const parts = [`Hemos copiado ${result.copied} ${result.copied === 1 ? 'plato' : 'platos'} a tu semana.`]
  if (swapped > 0) parts.push(`${swapped === 1 ? 'Uno no encajaba' : `${swapped} no encajaban`} con vuestras alergias o dieta y ${swapped === 1 ? 'lo hemos cambiado' : 'los hemos cambiado'} por otro parecido.`)
  if (dropped > 0) parts.push(`${dropped === 1 ? 'Un hueco se ha quedado' : `${dropped} huecos se han quedado`} sin plato: no había otro que encajara.`)
  return parts.join(' ')
}

/**
 * The matcher's pick for a swapped dish: same course and meal, the
 * household's rules, the week's vetoes; first among the recipes with the
 * same main protein (a similar dish), then any.
 */
export function similarRecipePicker(
  pool: RecipeWithCourse[],
  opts: { weekStart: string; restrictions: string[]; bannedRecipeIds?: Set<string> },
) {
  return (ctx: CopyPickContext) => {
    const options = {
      meal: ctx.meal,
      season: detectSeason(new Date(`${addDays(opts.weekStart, ctx.day)}T12:00:00Z`)),
      usedRecipeIds: ctx.usedRecipeIds,
      restrictions: opts.restrictions,
      favoriteRecipeIds: new Set<string>(),
      bannedRecipeIds: opts.bannedRecipeIds ?? new Set<string>(),
      dayIndex: ctx.day,
    }
    const protein = ctx.original ? mainProteinOf(ctx.original) : null
    const same = protein ? pool.filter((r) => r.id !== ctx.original?.id && mainProteinOf(r) === protein) : []
    const found = (same.length ? findForCourse(same, ctx.course, options) : undefined) ?? findForCourse(pool, ctx.course, options)
    return found ? { id: found.id, name: found.name, course: found.course ?? null } : null
  }
}

// ─── DB ─────────────────────────────────────────────────────

type Db = typeof defaultDb

export interface MonthMenuDishView {
  id: string
  name: string
  imageUrl: string | null
  totalTime: number | null
}

export interface MonthMenuView {
  id: string
  month: string
  title: string
  /** 7 days, Monday first; per meal, the dishes. */
  days: Array<Partial<Record<Meal, MonthMenuDishView[]>>>
}

async function viewOf(row: { id: string; month: string | null; title: string; week: MonthMenuWeek | null }, db: Db): Promise<MonthMenuView> {
  const week = Array.isArray(row.week) ? row.week : []
  const ids = [...new Set(week.flatMap((d) => Object.values(d ?? {}).flat() as string[]))]
  const rows = ids.length
    ? await db
        .select({ id: recipes.id, name: recipes.name, imageUrl: recipes.imageUrl, totalTime: recipes.totalTime, prepTime: recipes.prepTime, cookTime: recipes.cookTime, status: recipes.status })
        .from(recipes)
        .where(inArray(recipes.id, ids))
    : []
  const byId = new Map(rows.filter((r) => r.status === 'published').map((r) => [r.id, r]))
  const days = Array.from({ length: 7 }, (_, d) => {
    const out: Partial<Record<Meal, MonthMenuDishView[]>> = {}
    for (const meal of MEALS) {
      const list = (week[d]?.[meal] ?? [])
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({ id: r.id, name: r.name, imageUrl: r.imageUrl ?? null, totalTime: recipeTotalMinutes(r) }))
      if (list.length) out[meal] = list
    }
    return out
  })
  return { id: row.id, month: row.month ?? '', title: row.title, days }
}

async function loadRow(month: string, db: Db) {
  const [row] = await db
    .select({ id: catalogCollections.id, month: catalogCollections.month, title: catalogCollections.title, week: catalogCollections.week })
    .from(catalogCollections)
    .where(and(eq(catalogCollections.kind, MONTH_MENU_KIND), eq(catalogCollections.month, month)))
    .orderBy(desc(catalogCollections.updatedAt))
    .limit(1)
  return row ?? null
}

/** This month's menu (Madrid), or null. */
export async function loadMonthMenu(month: string = madridMonth(), db: Db = defaultDb): Promise<MonthMenuView | null> {
  const row = await loadRow(month, db)
  return row ? viewOf(row, db) : null
}

export type ImportMonthMenuResult =
  | { ok: true; menu: MonthMenuView; created: boolean }
  | { ok: false; problems: string[] }

/** The admin import: check the file and the rules, then save (one per month: a new file replaces it). */
export async function importMonthMenu(raw: unknown, adminId: string, db: Db = defaultDb): Promise<ImportMonthMenuResult> {
  const parsed = parseMonthMenuFile(raw)
  if (parsed.problems.length) return { ok: false, problems: parsed.problems }
  const catalogue = (
    await db
      .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId, internalTags: recipes.internalTags })
      .from(recipes)
      .where(and(isNull(recipes.authorId), eq(recipes.status, 'published')))
  ).filter((r) => !isRetiredRecipe(r))
  const { week, problems } = resolveMonthMenuRefs(parsed.refs, catalogue)
  if (problems.length) return { ok: false, problems }
  const pool = await loadMatchableRecipes(adminId, db)
  const byId = new Map<string, WeekRecipe>(pool.map((r) => [r.id, r]))
  const ruleProblems = checkMonthMenuRules(week, byId)
  if (ruleProblems.length) return { ok: false, problems: ruleProblems }

  const existing = await loadRow(parsed.month, db)
  const values = { title: parsed.title, week, updatedAt: new Date(), createdBy: adminId }
  let id: string
  if (existing) {
    await db.update(catalogCollections).set(values).where(eq(catalogCollections.id, existing.id))
    id = existing.id
  } else {
    const [row] = await db
      .insert(catalogCollections)
      .values({ ...values, slug: `menu-del-mes-${parsed.month}`, kind: MONTH_MENU_KIND, month: parsed.month })
      .returning({ id: catalogCollections.id })
    id = row.id
  }
  return { ok: true, created: !existing, menu: await viewOf({ id, month: parsed.month, title: parsed.title, week }, db) }
}

/** The menu owner's restrictions (profile + Mimo's memory) and every member's. */
async function loadRestrictions(userId: string, db: Db): Promise<string[]> {
  const [user] = await db.select({ restrictions: users.restrictions }).from(users).where(eq(users.id, userId)).limit(1)
  const memory = await getMemoryForUser(userId).catch(() => null)
  return withHouseholdRestrictions(mergeRestrictions(user?.restrictions, memory), userId, db)
}

export type CopyToWeekResult =
  | { status: 'not_found' }
  | { status: 'not_empty' }
  | { status: 'ok'; menuId: string; copied: number; swapped: number; dropped: number; notice: string }

/**
 * «Copiar a mi semana»: a new `menus` row for `weekStart` (the previous one
 * stays as history, as with generate) with the month's dishes. A week with
 * dishes needs `force` (the page asks «Se cambiarán los platos de esta semana»).
 */
export async function copyMonthMenuToWeek(
  opts: { userId: string; month: string; weekStart: string; force?: boolean },
  db: Db = defaultDb,
): Promise<CopyToWeekResult> {
  const row = await loadRow(opts.month, db)
  if (!row || !Array.isArray(row.week)) return { status: 'not_found' }
  const previous = await loadPreviousWeek(opts.userId, opts.weekStart, db)
  if (!opts.force && menuHasDishes(previous.days)) return { status: 'not_empty' }

  const [settings] = await db.select({ template: userSettings.template }).from(userSettings).where(eq(userSettings.userId, opts.userId)).limit(1)
  const template = normalizeMealTemplate(settings?.template) ?? defaultTemplate()
  const restrictions = await loadRestrictions(opts.userId, db)
  const pool = await loadMatchableRecipes(opts.userId, db)
  const result = copyMonthMenu({
    week: row.week,
    template,
    skippedDays: previous.skippedDays,
    recipesById: new Map(pool.map((r) => [r.id, r as CopyRecipe])),
    restrictions,
    pick: similarRecipePicker(pool, { weekStart: opts.weekStart, restrictions, bannedRecipeIds: previous.bannedRecipeIds }),
  })
  // A lock means «don't touch»: those slots keep what they had.
  keepLockedSlots(result.days, previous.days, previous.locked)
  const householdId = await getPrimaryHouseholdId(opts.userId)
  const [menu] = await db
    .insert(menus)
    .values({
      userId: opts.userId,
      householdId,
      weekStart: opts.weekStart,
      days: result.days,
      locked: previous.locked,
      bannedRecipeIds: [...previous.bannedRecipeIds],
      skippedDays: [...previous.skippedDays],
    })
    .returning({ id: menus.id })
  enqueuePrepAlertsForMenu(menu.id).catch((err) => console.warn('[month-menu] prep alerts failed:', err?.message ?? err))
  const swapped = result.swaps.filter((s) => s.to).length
  return { status: 'ok', menuId: menu.id, copied: result.copied, swapped, dropped: result.swaps.length - swapped, notice: copyNotice(result) }
}
