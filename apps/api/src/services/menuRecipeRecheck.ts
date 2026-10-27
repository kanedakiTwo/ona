/**
 * PRO-345 · Revisar los menús guardados cuando cambia una receta (Seguridad).
 *
 * The hogares de prueba (2026-10-22) had «Fajitas de pollo» on a gluten-free
 * Thursday after the catalogue recipe got «Tortillas de trigo», and a «Crema
 * de calabaza» that had been deleted («Esta receta ya no está», its
 * ingredients missing from the list). A saved menu is a snapshot of recipe
 * ids; the recipe behind an id can change or disappear later.
 *
 * So, from today on (Madrid) in every saved menu, a dish not yet eaten whose
 *   - recipe was deleted (`removed`), or
 *   - recipe changed after it entered the slot (`recipes.updated_at` later
 *     than the menu's creation and the last hand edit that put it there) and
 *     now breaks the allergies or diet of anyone in the household (`diet`)
 * is replaced by the matcher (same course, the household's restrictions, the
 * week's vetoes, not repeating the week) and carries `replaced` so the day
 * card says so. No candidate → a note that says why. The shopping list is
 * rebuilt from the menus on every read, so it follows by itself.
 *
 * «Changed after it entered» keeps a recipe the household picked by hand
 * knowing it breaks a rule (Mimo asks first, `confirmRestriction`) where it
 * is: only a later change of the recipe makes it stale, and picking it again
 * by hand after the swap writes a newer menu edit.
 *
 * A táper or leftover whose source was already cooked is food that exists:
 * kept on `diet`, turned into a note on `removed` (nothing links anymore).
 * A retired recipe (PRO-140) still exists and opens by id; it is only
 * checked for `diet`.
 *
 * When: right after `PUT /recipes/:id` and `DELETE /recipes/:id` (that
 * recipe only), and a full pass at boot and every hour, which catches the
 * catalogue fixes run on deploy (`catalogRecipeFixes.ts`) and scripts.
 *
 * Spec: specs/menus.md → «Cuando cambia una receta».
 */
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { detectSeason, isTaperVariant, type Course, type DayMenu, type Dish, type DishReplacedReason, type Meal, type MealSlot, type RecipeDish } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { ingredients, menuEdits, menus, recipeIngredients, recipes, users } from '../db/schema.js'
import { compileRestrictions, mergeRestrictions, violatesRestrictions, type RestrictableRecipe } from './dietaryRestrictions.js'
import { withHouseholdRestrictions } from './householdAllergies.js'
import { addDays, madridParts } from './madridTime.js'
import { loadMatchableRecipes } from './matchableRecipes.js'
import { findForCourse } from './courseAwareMatcher.js'
import { getMemoryForUser } from './userMemoryStore.js'
import { clearPendingForMenu, enqueuePrepAlertsForMenu } from './notificationScheduler.js'

export interface RecheckRecipe extends RestrictableRecipe {
  id: string
  name: string
  updatedAt: Date | null
}

export interface RecheckMenu {
  id: string
  weekStart: string
  createdAt: Date | null
  days: DayMenu[]
}

export interface StaleDish {
  day: number
  meal: string
  position: number
  recipeId: string
  recipeName: string
  reason: DishReplacedReason
}

export interface StaleDishesInput {
  menu: RecheckMenu
  /** The recipes the menu names; a missing id is a deleted recipe. */
  recipesById: ReadonlyMap<string, RecheckRecipe>
  /** Everyone's allergies and diets in the household. */
  restrictions: readonly string[]
  /** YYYY-MM-DD in Madrid: earlier days are left alone. */
  today: string
  /** When this recipe entered this slot (menu creation or the last hand edit). */
  enteredAt?: (day: number, meal: string, recipeId: string) => Date | null
  /** Only these recipes (the PUT / DELETE hooks). Absent = every recipe. */
  onlyRecipeIds?: ReadonlySet<string>
}

/** A dish already cooked: a táper, or a leftover whose source isn't being replaced. */
function isCookedDish(dish: RecipeDish): boolean {
  return isTaperVariant(dish.variant) || dish.variant === 'leftover'
}

/** Pure: the dishes from today on that no longer fit (see the header). */
export function staleDishes(input: StaleDishesInput): StaleDish[] {
  const { menu, recipesById, today, onlyRecipeIds } = input
  const rules = compileRestrictions(input.restrictions)
  const out: StaleDish[] = []
  const days = Array.isArray(menu.days) ? menu.days : []
  for (let day = 0; day < days.length; day++) {
    if (addDays(menu.weekStart, day) < today) continue
    for (const meal of Object.keys(days[day] ?? {})) {
      const slot = days[day][meal]
      if (!slot || slot.eaten || !Array.isArray(slot.dishes)) continue
      slot.dishes.forEach((dish, position) => {
        if (dish.kind !== 'recipe') return
        if (onlyRecipeIds && !onlyRecipeIds.has(dish.recipeId)) return
        const recipe = recipesById.get(dish.recipeId)
        if (!recipe) {
          out.push({ day, meal, position, recipeId: dish.recipeId, recipeName: dish.recipeName ?? 'La receta', reason: 'removed' })
          return
        }
        const entered = input.enteredAt?.(day, meal, dish.recipeId) ?? menu.createdAt
        const changedSince = recipe.updatedAt != null && (entered == null || recipe.updatedAt.getTime() > entered.getTime())
        if (!changedSince) return
        if (!violatesRestrictions(recipe, rules)) return
        out.push({ day, meal, position, recipeId: dish.recipeId, recipeName: recipe.name, reason: 'diet' })
      })
    }
  }
  return out
}

export interface PickedRecipe {
  id: string
  name: string
  course?: Course | null
}

export interface PickContext {
  day: number
  meal: string
  course: Course | null
  /** Every recipe left in the week (not to repeat). */
  usedRecipeIds: Set<string>
}

export interface DishChange extends StaleDish {
  /** The new recipe, or null when the dish became a note. */
  to: PickedRecipe | null
}

const NOTE_MAX = 120

function clip(name: string, room: number): string {
  return name.length <= room ? name : `${name.slice(0, Math.max(0, room - 1))}…`
}

/** Pure: the note left when nothing fits (or a cooked dish whose recipe is gone). */
export function staleNoteText(recipeName: string, reason: DishReplacedReason, cooked = false): string {
  if (cooked) return `Táper de «${clip(recipeName, NOTE_MAX - 12)}»`
  const tail = reason === 'diet' ? ' ya no encaja con vuestra dieta: elegid otro plato' : ' ya no está en el catálogo: elegid otro plato'
  return `«${clip(recipeName, NOTE_MAX - tail.length - 2)}»${tail}`
}

/**
 * Pure: the menu's days with the stale dishes replaced. `pick` chooses a
 * recipe for a slot (null = none fits). A leftover of a replaced dish
 * follows it; a cooked dish (táper, leftover of something not replaced)
 * is kept on `diet` and becomes a note on `removed`.
 */
export function replaceStaleDishes(
  days: DayMenu[],
  stale: readonly StaleDish[],
  pick: (ctx: PickContext) => PickedRecipe | null,
): { days: DayMenu[]; changes: DishChange[] } {
  const next: DayMenu[] = days.map((d) => {
    const copy: DayMenu = {}
    for (const meal of Object.keys(d ?? {})) {
      const slot = d[meal]
      copy[meal] = slot ? { ...slot, dishes: [...(slot.dishes ?? [])] } : slot
    }
    return copy
  })
  const used = new Set<string>()
  for (const d of next) {
    for (const slot of Object.values(d)) for (const dish of slot?.dishes ?? []) if (dish.kind === 'recipe') used.add(dish.recipeId)
  }
  const staleKeys = new Set(stale.map((s) => `${s.day}|${s.meal}|${s.position}`))
  const replacedAt = new Map<string, Dish>()
  const changes: DishChange[] = []
  const ordered = [...stale].sort((a, b) => a.day - b.day || a.meal.localeCompare(b.meal) || a.position - b.position)
  // Sources first: a leftover may sit at an earlier key than its source only
  // across meals of the same day, so leftovers go in a second round.
  const isLeftover = (s: StaleDish) => (next[s.day][s.meal]?.dishes[s.position] as RecipeDish | undefined)?.variant === 'leftover'
  for (const s of [...ordered.filter((x) => !isLeftover(x)), ...ordered.filter(isLeftover)]) {
    const slot = next[s.day][s.meal] as MealSlot
    const dish = slot.dishes[s.position] as RecipeDish
    let replacement: Dish | null = null
    let to: PickedRecipe | null = null
    if (dish.variant === 'leftover' && dish.leftoverOf) {
      const src = dish.leftoverOf
      const srcKey = `${src.day}|${src.meal}|${src.dishPosition}`
      const srcNew = replacedAt.get(srcKey)
      if (srcNew) {
        replacement = srcNew.kind === 'recipe'
          ? { ...srcNew, variant: 'leftover', leftoverOf: dish.leftoverOf }
          : { ...srcNew }
        to = srcNew.kind === 'recipe' ? { id: srcNew.recipeId, name: srcNew.recipeName ?? '', course: srcNew.course ?? null } : null
      } else if (staleKeys.has(srcKey)) {
        continue
      }
    }
    if (!replacement && isCookedDish(dish)) {
      if (s.reason === 'diet') continue
      replacement = { kind: 'note', text: staleNoteText(s.recipeName, s.reason, true) }
    }
    if (!replacement) {
      used.delete(s.recipeId)
      const picked = pick({ day: s.day, meal: s.meal, course: dish.course ?? null, usedRecipeIds: used })
      if (picked) {
        used.add(picked.id)
        to = picked
        replacement = {
          kind: 'recipe',
          recipeId: picked.id,
          recipeName: picked.name,
          course: picked.course ?? null,
          ...(dish.pinnedType ? { pinnedType: dish.pinnedType } : {}),
          replaced: { recipeName: s.recipeName, reason: s.reason },
        }
      } else {
        replacement = { kind: 'note', text: staleNoteText(s.recipeName, s.reason) }
      }
    }
    slot.dishes[s.position] = replacement
    replacedAt.set(`${s.day}|${s.meal}|${s.position}`, replacement)
    changes.push({ ...s, to })
  }
  return { days: next, changes }
}

// ─── DB ─────────────────────────────────────────────────────

type Db = typeof defaultDb

function recipeIdsIn(days: DayMenu[]): Set<string> {
  const ids = new Set<string>()
  for (const d of Array.isArray(days) ? days : []) {
    for (const slot of Object.values(d ?? {})) for (const dish of slot?.dishes ?? []) if (dish.kind === 'recipe') ids.add(dish.recipeId)
  }
  return ids
}

/** A dish id that isn't a uuid (old data) would make the `IN (…)` query fail. */
const isUuid = (id: string) => z.string().uuid().safeParse(id).success

async function loadRecheckRecipes(ids: string[], db: Db): Promise<Map<string, RecheckRecipe>> {
  const valid = ids.filter(isUuid)
  const out = new Map<string, RecheckRecipe>()
  if (valid.length === 0) return out
  const [rows, lines] = await Promise.all([
    db
      .select({ id: recipes.id, name: recipes.name, allergens: recipes.allergens, updatedAt: recipes.updatedAt })
      .from(recipes)
      .where(inArray(recipes.id, valid)),
    db
      .select({
        recipeId: recipeIngredients.recipeId,
        ingredientName: ingredients.name,
        allergenTags: ingredients.allergenTags,
        containsTags: ingredients.containsTags,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(inArray(recipeIngredients.recipeId, valid)),
  ])
  const linesByRecipe = new Map<string, RecheckRecipe['ingredients'][number][]>()
  for (const l of lines) {
    const list = linesByRecipe.get(l.recipeId) ?? []
    list.push({ ingredientName: l.ingredientName, allergenTags: l.allergenTags ?? [], containsTags: l.containsTags ?? [] })
    linesByRecipe.set(l.recipeId, list)
  }
  for (const r of rows) {
    out.set(r.id, { id: r.id, name: r.name, allergens: r.allergens ?? [], updatedAt: r.updatedAt ?? null, ingredients: linesByRecipe.get(r.id) ?? [] })
  }
  return out
}

/** The menu owner's restrictions (profile + Mimo's memory) and every member's. */
async function loadMenuRestrictions(userId: string, db: Db): Promise<string[]> {
  const [user] = await db.select({ restrictions: users.restrictions }).from(users).where(eq(users.id, userId)).limit(1)
  const memory = await getMemoryForUser(userId).catch(() => null)
  return withHouseholdRestrictions(mergeRestrictions(user?.restrictions, memory), userId, db)
}

/** Last hand edit that put each recipe in each slot of the menu. */
async function loadEnteredAt(menuId: string, db: Db): Promise<Map<string, Date>> {
  const rows = await db
    .select({ day: menuEdits.day, meal: menuEdits.meal, recipeId: menuEdits.afterRecipeId, createdAt: menuEdits.createdAt })
    .from(menuEdits)
    .where(eq(menuEdits.menuId, menuId))
  const out = new Map<string, Date>()
  for (const r of rows) {
    if (r.day == null || !r.meal || !r.recipeId) continue
    const key = `${r.day}|${r.meal}|${r.recipeId}`
    const prev = out.get(key)
    if (!prev || r.createdAt > prev) out.set(key, r.createdAt)
  }
  return out
}

async function defaultPicker(menu: { userId: string; bannedRecipeIds: string[] | null; weekStart: string }, restrictions: string[]) {
  const pool = await loadMatchableRecipes(menu.userId)
  const banned = new Set(menu.bannedRecipeIds ?? [])
  return (ctx: PickContext): PickedRecipe | null => {
    const found = findForCourse(pool, ctx.course, {
      meal: ctx.meal as Meal,
      season: detectSeason(new Date(`${addDays(menu.weekStart, ctx.day)}T12:00:00Z`)),
      usedRecipeIds: ctx.usedRecipeIds,
      restrictions,
      favoriteRecipeIds: new Set(),
      bannedRecipeIds: banned,
      dayIndex: ctx.day,
    })
    return found ? { id: found.id, name: found.name, course: found.course ?? null } : null
  }
}

export interface RecheckOptions {
  /** Only menus holding these recipes, and only those dishes. Absent = full pass. */
  recipeIds?: readonly string[]
  now?: Date
  db?: Db
  /** Tests: replace the matcher. */
  picker?: typeof defaultPicker
}

export interface RecheckResult {
  menus: number
  changes: Array<DishChange & { menuId: string }>
}

/**
 * Re-check the saved menus from today on and replace what no longer fits.
 * Never throws for one menu: logs and goes on with the next.
 */
export async function recheckSavedMenus(opts: RecheckOptions = {}): Promise<RecheckResult> {
  const db = opts.db ?? defaultDb
  const today = madridParts(opts.now ?? new Date()).isoDate
  const only = opts.recipeIds ? new Set(opts.recipeIds.filter(isUuid)) : undefined
  if (only && only.size === 0) return { menus: 0, changes: [] }

  const conds = [gte(menus.weekStart, addDays(today, -6))]
  if (only) conds.push(or(...[...only].map((id) => sql`${menus.days}::text LIKE ${`%${id}%`}`))!)
  const rows = await db
    .select({ id: menus.id, userId: menus.userId, weekStart: menus.weekStart, createdAt: menus.createdAt, days: menus.days, bannedRecipeIds: menus.bannedRecipeIds })
    .from(menus)
    .where(and(...conds))
  if (rows.length === 0) return { menus: 0, changes: [] }

  const allIds = new Set<string>()
  for (const r of rows) for (const id of recipeIdsIn(r.days as DayMenu[])) if (!only || only.has(id)) allIds.add(id)
  const recipesById = await loadRecheckRecipes([...allIds], db)
  const result: RecheckResult = { menus: 0, changes: [] }

  for (const row of rows) {
    try {
      const days = row.days as DayMenu[]
      const menu: RecheckMenu = { id: row.id, weekStart: row.weekStart, createdAt: row.createdAt ?? null, days }
      // Cheap pass first, without restrictions: anything deleted or changed after the menu?
      const ids = [...recipeIdsIn(days)].filter((id) => !only || only.has(id))
      const maybe = ids.some((id) => {
        const r = recipesById.get(id)
        return !r || (r.updatedAt != null && (menu.createdAt == null || r.updatedAt > menu.createdAt))
      })
      if (!maybe) continue

      const restrictions = await loadMenuRestrictions(row.userId, db)
      const entered = await loadEnteredAt(row.id, db)
      const stale = staleDishes({
        menu,
        recipesById,
        restrictions,
        today,
        onlyRecipeIds: only,
        enteredAt: (day, meal, recipeId) => {
          const e = entered.get(`${day}|${meal}|${recipeId}`)
          return e && (!menu.createdAt || e > menu.createdAt) ? e : menu.createdAt
        },
      })
      if (stale.length === 0) continue

      const pick = await (opts.picker ?? defaultPicker)(row, restrictions)
      const { days: nextDays, changes } = replaceStaleDishes(days, stale, pick)
      if (changes.length === 0) continue
      // Only if nobody changed the menu meanwhile; the next pass retries.
      const updated = await db
        .update(menus)
        .set({ days: nextDays as any })
        .where(and(eq(menus.id, row.id), sql`${menus.days} = ${JSON.stringify(days)}::jsonb`))
        .returning({ id: menus.id })
      if (updated.length === 0) continue
      result.menus++
      for (const c of changes) {
        result.changes.push({ ...c, menuId: row.id })
        console.log(`[menu-recheck] menu ${row.id} day ${c.day} ${c.meal}: «${c.recipeName}» (${c.reason}) → ${c.to ? `«${c.to.name}»` : 'nota'}`)
      }
      void refreshPrepAlerts(row.id)
    } catch (err: any) {
      console.warn(`[menu-recheck] menu ${row.id} failed (skipped):`, err?.message ?? err)
    }
  }
  return result
}

async function refreshPrepAlerts(menuId: string): Promise<void> {
  try {
    await clearPendingForMenu(menuId)
    await enqueuePrepAlertsForMenu(menuId)
  } catch (err) {
    console.warn('[menu-recheck] re-enqueue prep alerts failed:', err)
  }
}

/** For the recipe routes: re-check that recipe's menus without making the response wait. */
export function recheckMenusForRecipe(recipeId: string): void {
  recheckSavedMenus({ recipeIds: [recipeId] }).catch((err) => {
    console.warn('[menu-recheck] after recipe change failed:', err?.message ?? err)
  })
}

let intervalHandle: ReturnType<typeof setInterval> | null = null

/** Full pass at boot (after a minute) and every hour. Idempotent. */
export function startMenuRecipeRecheck(opts: { intervalMs?: number; firstDelayMs?: number } = {}): void {
  if (intervalHandle) return
  let running = false
  const run = () => {
    if (running) return
    running = true
    recheckSavedMenus()
      .catch((err) => console.warn('[menu-recheck] pass failed:', err?.message ?? err))
      .finally(() => {
        running = false
      })
  }
  setTimeout(run, opts.firstDelayMs ?? 60_000).unref?.()
  intervalHandle = setInterval(run, opts.intervalMs ?? 60 * 60 * 1000)
  intervalHandle.unref?.()
}
