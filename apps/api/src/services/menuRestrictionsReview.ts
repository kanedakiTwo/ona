/**
 * PRO-364 · Revisar los menús guardados cuando alguien de la casa guarda o
 * cambia sus alergias o su dieta (Seguridad).
 *
 * A menu is checked against the household's restrictions when it is built,
 * but restrictions can arrive later: the health consent (PRO-21) comes after
 * the first menu, someone fills the profile, tells Mimo, or a new member
 * answers «Tus alergias y tu dieta» (PRO-271). 2026-10-23: a coeliac,
 * lactose-intolerant household had pizza on Saturday that way.
 *
 * So every path that saves restrictions (`PUT /user/:id`, the `restrictions`
 * memory key — Mimo, `/memory`, the fridge question) calls
 * `reviewHouseholdMenus`: the household's saved menus from today on are
 * checked dish by dish with `violatesRestrictions` and everyone's
 * restrictions (`withHouseholdRestrictions`). A dish that no longer fits is
 * re-picked like «Cambiar» does (`menuSlotPick.ts`); when nothing fits it
 * stays with `restrictionConflict: true` and the day's card says so. Days and
 * meals already past, eaten slots and fixed («Fijada») slots are never
 * changed (a fixed one gets the warning). Tápers already cooked get the
 * warning too; a leftover follows the dish it comes from.
 *
 * The rolling shopping list (`GET /shopping-list`) is rebuilt from the menus
 * on every read; a list saved for one menu (`shopping_lists.menu_id`) gets its
 * menu lines rebuilt here, keeping the manual ones.
 *
 * Best-effort: it never fails the save that triggered it.
 * Spec: specs/menus.md → «Cuando cambian las alergias o la dieta».
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { isTaperVariant, type DayMenu, type Dish, type LockedSlots, type RecipeDish } from '@ona/shared'
import { db } from '../db/connection.js'
import { ingredients, menus, recipeIngredients, recipeSteps, recipes, shoppingLists, users } from '../db/schema.js'
import { compileRestrictions, violatesRestrictions, type RestrictableRecipe } from './dietaryRestrictions.js'
import { findForCourse } from './courseAwareMatcher.js'
import { madridParts, madridWeekStart } from './madridTime.js'
import { recordMenuEdits, slotDiff, type MenuEditChange } from './menuEdits.js'
import { loadMenuRestrictions, loadSlotPickContext, slotPickOptions, type SlotPickContext } from './menuSlotPick.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'
import { unlistedDietMentions } from './stepDietMentions.js'
import { generateShoppingList, mergeStaplesIntoItems, withLeftoverBatches } from './shoppingList.js'
import { listActiveStaplesForHousehold } from './staplesStore.js'
import { clearPendingForMenu, enqueuePrepAlertsForMenu } from './notificationScheduler.js'
import { householdMultiplier, householdSizeToCounts, type HouseholdSize } from '@ona/shared'

/** The hour (Madrid) from which today's meal counts as past — the shopping list's cutoffs. */
const MEAL_PAST_HOUR: Record<string, number> = { breakfast: 10, lunch: 16, snack: 19, dinner: 23 }

/** Pure: may this slot still be changed? Day index 0-6 from `weekStart`. */
export function slotIsAhead(weekStart: string, dayIndex: number, meal: string, now: Date): boolean {
  const { isoDate, hour } = madridParts(now)
  const d = new Date(`${weekStart}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dayIndex)
  const date = d.toISOString().slice(0, 10)
  if (date < isoDate) return false
  if (date > isoDate) return true
  const past = MEAL_PAST_HOUR[meal]
  return past === undefined || hour < past
}

export interface ReviewResult {
  /** Dishes changed for another recipe. */
  swapped: Array<{ menuId: string; day: number; meal: string; before: string; after: string }>
  /** Dishes that break a restriction and stay, with the warning. */
  warned: Array<{ menuId: string; day: number; meal: string; recipe: string }>
}

type RecipeForCheck = RestrictableRecipe & { id: string; name: string }

/** A dish id that isn't a uuid (old data) would make the `IN (…)` query fail (as in PRO-345). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Each recipe as the matcher sees it: allergens, ingredients and what the steps name (PRO-346). */
async function loadRecipesForCheck(allIds: string[]): Promise<Map<string, RecipeForCheck>> {
  const ids = allIds.filter((id) => UUID.test(id))
  if (ids.length === 0) return new Map()
  const [rows, ingRows, stepRows] = await Promise.all([
    db.select({ id: recipes.id, name: recipes.name, allergens: recipes.allergens }).from(recipes).where(inArray(recipes.id, ids)),
    db
      .select({
        recipeId: recipeIngredients.recipeId,
        ingredientName: ingredients.name,
        allergenTags: ingredients.allergenTags,
        containsTags: ingredients.containsTags,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(inArray(recipeIngredients.recipeId, ids)),
    db
      .select({ recipeId: recipeSteps.recipeId, index: recipeSteps.index, text: recipeSteps.text })
      .from(recipeSteps)
      .where(inArray(recipeSteps.recipeId, ids)),
  ])
  return new Map(
    rows.map((r): [string, RecipeForCheck] => {
      const lines = ingRows.filter((i) => i.recipeId === r.id)
      const steps = stepRows
        .filter((st) => st.recipeId === r.id)
        .sort((a, b) => a.index - b.index)
        .map((st) => st.text)
      // PRO-346: meat, fish or allergens the steps name and the ingredients don't, like `loadMatchableRecipes`.
      const stepMentions = unlistedDietMentions(steps, lines.map((i) => i.ingredientName)).map(({ term, category }) => ({ term, category }))
      return [r.id, { id: r.id, name: r.name, allergens: r.allergens ?? [], ingredients: lines, stepMentions }]
    }),
  )
}

function recipeIdsOf(days: DayMenu[]): Set<string> {
  const ids = new Set<string>()
  for (const day of days) for (const slot of Object.values(day)) for (const d of slot?.dishes ?? []) if (d.kind === 'recipe') ids.add(d.recipeId)
  return ids
}

function withoutConflict(d: RecipeDish): RecipeDish {
  const { restrictionConflict: _drop, ...rest } = d
  return rest
}

/** Another recipe in the dish's place: neither the warning nor PRO-345's «En lugar de …» (it named the old one) stay. */
function withoutMarks(d: RecipeDish): Omit<RecipeDish, 'restrictionConflict' | 'replaced' | 'why'> {
  const { restrictionConflict: _c, replaced: _r, why: _w, ...rest } = d
  return rest
}

type MenuRow = typeof menus.$inferSelect

/** Review one menu. Returns the new days (null when nothing changed). */
async function reviewMenu(menu: MenuRow, requesterId: string, now: Date, result: ReviewResult): Promise<{ days: DayMenu[]; changes: MenuEditChange[] } | null> {
  const days = structuredClone(menu.days as DayMenu[])
  const locked = (menu.locked as LockedSlots | null) ?? {}
  const pickMenu = { userId: menu.userId, householdId: menu.householdId, weekStart: String(menu.weekStart), bannedRecipeIds: menu.bannedRecipeIds }
  let ctx: SlotPickContext | null = null
  const getCtx = async () => (ctx ??= await loadSlotPickContext(pickMenu, requesterId))
  const checked = await loadRecipesForCheck([...recipeIdsOf(days)])
  const rules = compileRestrictions((await loadMenuRestrictions(menu)).restrictions)
  const breaks = (id: string) => {
    const r = checked.get(id)
    return r ? violatesRestrictions(r, rules) : false
  }

  let changed = false
  const changes: MenuEditChange[] = []
  /** `day:meal:position` of a planned dish → the recipe it became, for its leftovers. */
  const replacedAt = new Map<string, RecipeDish>()

  // Planned dishes first, so leftovers can follow their source.
  for (const pass of ['planned', 'derived'] as const) {
    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
      for (const meal of Object.keys(days[dayIndex] ?? {})) {
        const slot = days[dayIndex][meal]
        if (!slot || !Array.isArray(slot.dishes)) continue
        if (!slotIsAhead(String(menu.weekStart), dayIndex, meal, now) || slot.eaten) continue
        const before = slot.dishes
        const next: Dish[] = [...before]
        for (let i = 0; i < before.length; i++) {
          const dish = before[i]
          if (dish.kind !== 'recipe') continue
          const derived = dish.variant === 'leftover' || isTaperVariant(dish.variant)
          if ((pass === 'planned') === derived) continue

          if (!breaks(dish.recipeId)) {
            if (dish.restrictionConflict) {
              next[i] = withoutConflict(dish)
              changed = true
            }
            continue
          }
          const warn = () => {
            if (!dish.restrictionConflict) {
              next[i] = { ...dish, restrictionConflict: true }
              changed = true
            }
            result.warned.push({ menuId: menu.id, day: dayIndex, meal, recipe: dish.recipeName ?? checked.get(dish.recipeId)?.name ?? dish.recipeId })
          }

          if (locked[String(dayIndex)]?.[meal] || isTaperVariant(dish.variant)) {
            warn()
            continue
          }
          let picked: RecipeDish | null = null
          if (dish.variant === 'leftover') {
            const src = dish.leftoverOf ? replacedAt.get(`${dish.leftoverOf.day}:${dish.leftoverOf.meal}:${dish.leftoverOf.dishPosition}`) : undefined
            if (src) picked = { ...withoutMarks(dish), recipeId: src.recipeId, recipeName: src.recipeName, course: src.course ?? null }
          } else {
            // Like «Cambiar»: every recipe of the week except this slot's is taken.
            const used = recipeIdsOf(days.map((d, di) => (di === dayIndex ? { ...d, [meal]: { dishes: next.filter((x) => x !== dish) } } : d)))
            const { pool, options } = await slotPickOptions(await getCtx(), pickMenu, dayIndex, meal, used)
            const found = findForCourse(pool, dish.course ?? null, options)
            if (found && !violatesRestrictions(found, rules)) {
              picked = { ...withoutMarks(dish), kind: 'recipe', recipeId: found.id, recipeName: found.name, course: found.course ?? null }
            }
          }
          if (!picked) {
            warn()
            continue
          }
          next[i] = picked
          changed = true
          replacedAt.set(`${dayIndex}:${meal}:${i}`, picked)
          result.swapped.push({ menuId: menu.id, day: dayIndex, meal, before: dish.recipeName ?? dish.recipeId, after: picked.recipeName ?? picked.recipeId })
        }
        days[dayIndex][meal] = { ...slot, dishes: next }
        changes.push(...slotDiff(dayIndex, meal, before, next))
      }
    }
  }
  return changed ? { days, changes } : null
}

/** A list saved for one menu: rebuild its menu lines, keep the manual ones (like «Regenerar»). */
async function rebuildMenuShoppingLists(menu: MenuRow, days: DayMenu[]): Promise<void> {
  const lists = await db.select().from(shoppingLists).where(eq(shoppingLists.menuId, menu.id))
  if (lists.length === 0) return
  const [owner] = await db
    .select({ adults: users.adults, kidsCount: users.kidsCount, householdSize: users.householdSize })
    .from(users)
    .where(eq(users.id, menu.userId))
    .limit(1)
  const counts =
    typeof owner?.adults === 'number' && owner.adults > 0
      ? { adults: owner.adults, kidsCount: owner.kidsCount ?? 0 }
      : householdSizeToCounts(owner?.householdSize as HouseholdSize | null | undefined)
  const multiplier = householdMultiplier(counts.adults, counts.kidsCount)
  for (const list of lists) {
    const householdId = list.householdId ?? menu.householdId ?? null
    const menuItems = await generateShoppingList(withLeftoverBatches(days, multiplier), multiplier, db, householdId)
    const manualKept = ((list.items ?? []) as any[]).filter((i) => i.kind === 'manual')
    const staples = householdId ? await listActiveStaplesForHousehold(householdId) : []
    await db.update(shoppingLists).set({ items: mergeStaplesIntoItems([...menuItems, ...manualKept], staples) }).where(eq(shoppingLists.id, list.id))
  }
}

/**
 * Check the household's saved menus from this week on against everyone's
 * restrictions now, and fix them. `userId`: whoever just saved theirs.
 */
export async function reviewHouseholdMenus(userId: string, opts: { now?: Date } = {}): Promise<ReviewResult> {
  const now = opts.now ?? new Date()
  const result: ReviewResult = { swapped: [], warned: [] }
  const householdId = await getPrimaryHouseholdId(userId)
  const rows = await db
    .select()
    .from(menus)
    .where(
      and(householdId ? eq(menus.householdId, householdId) : eq(menus.userId, userId), sql`${menus.weekStart} >= ${madridWeekStart(now)}`),
    )
    .orderBy(desc(menus.createdAt))
  // Only the latest menu of each week counts (like the shopping list).
  const latest = new Map<string, MenuRow>()
  for (const m of rows) if (!latest.has(String(m.weekStart))) latest.set(String(m.weekStart), m)

  for (const menu of latest.values()) {
    const reviewed = await reviewMenu(menu, userId, now, result)
    if (!reviewed) continue
    await db.update(menus).set({ days: reviewed.days }).where(eq(menus.id, menu.id))
    await recordMenuEdits({ userId }, menu, reviewed.changes)
    await rebuildMenuShoppingLists(menu, reviewed.days).catch((err) => console.warn('[menu-review] shopping list:', err?.message ?? err))
    try {
      await clearPendingForMenu(menu.id)
      await enqueuePrepAlertsForMenu(menu.id)
    } catch (err) {
      console.warn('[menu-review] prep alerts:', (err as Error)?.message ?? err)
    }
  }
  return result
}

/** For the save paths: never throws, logs what it did. */
export async function reviewHouseholdMenusSafely(userId: string): Promise<ReviewResult | null> {
  try {
    const r = await reviewHouseholdMenus(userId)
    if (r.swapped.length || r.warned.length) console.info(`[menu-review] ${userId}: ${r.swapped.length} cambiados, ${r.warned.length} con aviso`)
    return r
  } catch (err) {
    console.warn('[menu-review] failed (ignored):', (err as Error)?.message ?? err)
    return null
  }
}
