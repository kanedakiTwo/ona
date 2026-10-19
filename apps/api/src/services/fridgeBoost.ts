import { fridgeTerm, type DayMenu, type LockedSlots, type RecipeDish } from '@ona/shared'
import { normalizeText } from './dietaryRestrictions.js'
import { nameHasTerm } from './nutrition/allergens.js'
import { isBasicIngredient, singularTerm } from './withWhatIHave.js'
import { addPantryForUser, listPantryForUser, NoHouseholdError } from './pantryStore.js'

/**
 * PRO-229 · «¿Qué te queda en la nevera?» before planning. What the household
 * says goes into the despensa (place «nevera»); the next menu gives more weight
 * to recipes that use it and, if the draw left them all out, puts one in —
 * as early in the week as it fits, since that's what spoils first.
 */

/** Fridge rows count while fresh: what was said in the last week. */
export const FRIDGE_FRESH_DAYS = 7

interface FridgeRow { name: string; location?: string; quantity: number; storedAt: string }

/** Food words of what's in the fridge now: «medio calabacín» → «calabacin». Basics (sal, aceite…) out. */
export function fridgeTermsOf(rows: readonly FridgeRow[], now: Date): string[] {
  const since = now.getTime() - FRIDGE_FRESH_DAYS * 24 * 60 * 60 * 1000
  const terms = rows
    .filter((r) => r.location === 'nevera' && r.quantity > 0 && Date.parse(r.storedAt) >= since)
    .map((r) => singularTerm(fridgeTerm(r.name)).split(' ')[0] ?? '')
    .filter((t) => t.length >= 3 && !isBasicIngredient(t))
  return [...new Set(terms)]
}

/** Recipe ids that use at least one of those words in an ingredient name. */
export function recipesUsingFridge(
  recipes: ReadonlyArray<{ id: string; ingredients: ReadonlyArray<{ ingredientName: string }> }>,
  terms: readonly string[],
): Set<string> {
  const out = new Set<string>()
  if (terms.length === 0) return out
  for (const r of recipes) {
    if (r.ingredients.some((i) => terms.some((t) => nameHasTerm(normalizeText(i.ingredientName), t)))) out.add(r.id)
  }
  return out
}

/**
 * If no dish of the week uses the fridge, put one in: the first free lunch or
 * dinner (Monday first) for which `pick` finds a recipe. Locked slots,
 * skipped days, notes, leftovers and freezer dishes are never touched; the
 * slot keeps its `servings`. Returns the week (a copy when changed).
 */
export function ensureFridgeRecipe(
  days: DayMenu[],
  fridgeRecipeIds: ReadonlySet<string>,
  pick: (dayIndex: number, meal: string, usedRecipeIds: Set<string>) => { id: string; name: string; course?: RecipeDish['course'] } | undefined,
  locked: LockedSlots = {},
  skippedDays?: ReadonlySet<number>,
): { days: DayMenu[]; placed: { dayIndex: number; meal: string; recipeId: string } | null } {
  if (fridgeRecipeIds.size === 0) return { days, placed: null }
  const used = new Set<string>()
  for (const d of days) for (const slot of Object.values(d ?? {})) for (const dish of slot?.dishes ?? []) if (dish.kind === 'recipe') used.add(dish.recipeId)
  if ([...used].some((id) => fridgeRecipeIds.has(id))) return { days, placed: null }

  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    if (skippedDays?.has(dayIndex)) continue
    for (const meal of ['lunch', 'dinner']) {
      const slot = days[dayIndex]?.[meal]
      if (!slot || locked[String(dayIndex)]?.[meal]) continue
      const at = (slot.dishes ?? []).findIndex(
        (d) => d.kind === 'recipe' && !d.variant && !d.leftoverOf && (d.course == null || d.course === 'main'),
      )
      if (at < 0) continue
      const recipe = pick(dayIndex, meal, used)
      if (!recipe) continue
      const dishes = [...slot.dishes]
      dishes[at] = { kind: 'recipe', recipeId: recipe.id, recipeName: recipe.name, course: recipe.course ?? null } as RecipeDish
      const next = days.map((d) => ({ ...d }))
      next[dayIndex][meal] = { ...slot, dishes }
      return { days: next, placed: { dayIndex, meal, recipeId: recipe.id } }
    }
  }
  return { days, placed: null }
}

/** What the household said is left: into the despensa as «nevera» (best effort, never blocks the menu). */
export async function rememberFridge(userId: string, said: readonly string[] | undefined, db?: any): Promise<void> {
  if (!said?.length) return
  const existing = await listPantryForUser(userId, db).catch(() => [])
  for (const name of said) {
    const n = normalizeText(name)
    const hit = existing.find((r) => normalizeText(r.name) === n)
    if (hit && hit.location === 'nevera') continue
    try {
      await addPantryForUser(userId, { name: name.trim().slice(0, 80), location: 'nevera' }, db)
    } catch (err) {
      if (!(err instanceof NoHouseholdError)) console.warn('[fridge] could not save', name, err)
      return
    }
  }
}

/** The household's fresh fridge words (for the generator); [] on any error. */
export async function loadFridgeTerms(userId: string, db?: any, now: Date = new Date()): Promise<string[]> {
  const rows = await listPantryForUser(userId, db, { location: 'nevera' }).catch(() => [])
  return fridgeTermsOf(rows, now)
}
