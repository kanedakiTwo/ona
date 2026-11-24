/**
 * The WhatsApp sign-up's first menu (Miguel, 19-nov). The sign-up asks four
 * things (who they are, which meals they cook, three dishes they make often,
 * what doesn't go in) and all of it goes where the menu reads it:
 *
 * - «6 cenas y 1 comida» → the household's «semana tipo» (`off` on the
 *   meals they don't cook) and how often they cook;
 * - the dishes they make often go into the first menu for sure: the
 *   catalogue's (or their own) recipe when there is one, else a note with the
 *   dish's name that Mimo turns into the household's recipe (swap_meal with
 *   newRecipe) in the same turn.
 *
 * Pure, so the rules are unit-tested (`signupFirstMenu.test.ts`).
 */
import type { CookingFrequency, DayMenu, LockedSlots, Meal, RecipeDish, WeekTypeSlot } from '@ona/shared'
import { asksWeekType } from './weekTypePlan.js'
import { nameHasTerm } from './nutrition/allergens.js'
import { normalizeText } from './dietaryRestrictions.js'
import { dishWords } from './onboardingPreferences.js'

/** Days (0 = Monday) a household cooks N lunches on: the weekend first. */
const LUNCH_DAYS_ORDER = [6, 5, 0, 1, 2, 3, 4]
/** …and N dinners on: weekdays first, Saturday (the night out) last. */
const DINNER_DAYS_ORDER = [0, 1, 2, 3, 4, 6, 5]

const clampCount = (n: unknown): number | undefined =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(7, Math.round(n))) : undefined

/** The days of the week (0 = Monday) the household cooks `count` of a meal on. */
export function cookedDays(meal: 'lunch' | 'dinner', count: number): number[] {
  const order = meal === 'lunch' ? LUNCH_DAYS_ORDER : DINNER_DAYS_ORDER
  return order.slice(0, count).sort((a, b) => a - b)
}

/**
 * «6 cenas y 1 comida» → the week type's lunch and dinner slots: «no hay» on
 * the days they don't cook it, «libre» on the rest. A meal not said (or all
 * seven) changes nothing.
 */
export function weekTypeForMealCounts(lunches?: number, dinners?: number): Array<{ day: number; meal: Meal; slot: WeekTypeSlot }> {
  const out: Array<{ day: number; meal: Meal; slot: WeekTypeSlot }> = []
  for (const [meal, raw] of [['lunch', lunches], ['dinner', dinners]] as const) {
    const count = clampCount(raw)
    if (count === undefined || count === 7) continue
    const on = new Set(cookedDays(meal, count))
    for (let day = 0; day < 7; day++) out.push({ day, meal, slot: on.has(day) ? {} : { off: true } })
  }
  return out
}

/** How often they cook, from the meals said: days with a cooked meal. Nothing said → undefined. */
export function cookingFreqForMealCounts(lunches?: number, dinners?: number): CookingFrequency | undefined {
  const l = clampCount(lunches)
  const d = clampCount(dinners)
  if (l === undefined && d === undefined) return undefined
  const days = new Set([...cookedDays('lunch', l ?? 7), ...cookedDays('dinner', d ?? 7)]).size
  return days >= 6 ? 'daily' : days >= 3 ? '3_4_times' : 'rarely'
}

/** «patatas» → «patata»: `nameHasTerm` already takes the plural of a term. */
const singular = (w: string) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)

export interface DishCandidate {
  id: string
  name: string
  meals?: string[] | null
  authorId?: string | null
}

/**
 * The recipe that IS a dish the household makes: every significant word of
 * the dish in its name («Salmón al horno con patatas» → salmón, horno,
 * patatas). Their own recipe first, then the shortest name. Null = not in
 * their recipes nor the catalogue.
 */
export function recipeForDish<R extends DishCandidate>(dish: string, recipes: readonly R[], userId?: string): R | null {
  const words = dishWords(dish).map(singular)
  if (words.length === 0) return null
  const hits = recipes.filter((r) => {
    const name = normalizeText(r.name)
    return words.every((w) => nameHasTerm(name, w))
  })
  if (hits.length === 0) return null
  return [...hits].sort((a, b) => Number(b.authorId === userId && !!userId) - Number(a.authorId === userId && !!userId) || a.name.length - b.name.length)[0]
}

export interface SignupDish {
  /** As the household said it. */
  dish: string
  recipe: DishCandidate | null
}

export interface PlacedDish {
  dish: string
  dayIndex: number
  meal: 'lunch' | 'dinner'
  /** The recipe's name; absent = a note with the dish's name (no recipe yet). */
  recipeName?: string
  /** It was already in the week as drawn. */
  already?: boolean
}

const MAIN_SLOTS = ['dinner', 'lunch'] as const

/**
 * Put each dish in the week: a recipe already drawn stays where it is;
 * otherwise it takes the main dish of a lunch or dinner (dinner first, one
 * dish per day, the earliest day first, a meal its recipe fits first). Locked
 * slots, leftovers and what the week type asks for (its recipe, a dish of
 * its type; PRO-1296) are never touched. The
 * dishes that found no slot come back in `left` (next week takes them).
 */
export function placeSignupDishes(
  days: DayMenu[],
  dishes: readonly SignupDish[],
  locked: LockedSlots = {},
): { days: DayMenu[]; placed: PlacedDish[]; left: SignupDish[] } {
  const next = days.map((d) => ({ ...d }))
  const placed: PlacedDish[] = []
  const left: SignupDish[] = []
  const usedDays = new Set<number>()
  const where = new Map<string, { dayIndex: number; meal: 'lunch' | 'dinner' }>()
  next.forEach((d, dayIndex) => {
    for (const meal of MAIN_SLOTS) for (const dish of d?.[meal]?.dishes ?? []) if (dish.kind === 'recipe' && !where.has(dish.recipeId)) where.set(dish.recipeId, { dayIndex, meal })
  })
  const mainAt = (dayIndex: number, meal: 'lunch' | 'dinner') => {
    const slot = next[dayIndex]?.[meal]
    if (!slot || locked[String(dayIndex)]?.[meal]) return -1
    return (slot.dishes ?? []).findIndex(
      (d) => d.kind === 'recipe' && (d.variant ?? 'planned') === 'planned' && !d.leftoverOf && !asksWeekType(d) && (d.course == null || d.course === 'main'),
    )
  }
  const freeSlot = (recipe: DishCandidate | null): { dayIndex: number; meal: 'lunch' | 'dinner'; at: number } | null => {
    const fits = (meal: string) => !recipe?.meals?.length || recipe.meals.includes(meal)
    for (const strict of [true, false]) {
      for (let dayIndex = 0; dayIndex < next.length; dayIndex++) {
        if (usedDays.has(dayIndex)) continue
        for (const meal of MAIN_SLOTS) {
          if (strict && !fits(meal)) continue
          const at = mainAt(dayIndex, meal)
          if (at >= 0) return { dayIndex, meal, at }
        }
      }
    }
    return null
  }
  for (const d of dishes) {
    const already = d.recipe ? where.get(d.recipe.id) : undefined
    if (already) {
      usedDays.add(already.dayIndex)
      placed.push({ dish: d.dish, ...already, recipeName: d.recipe!.name, already: true })
      continue
    }
    const slot = freeSlot(d.recipe)
    if (!slot) {
      left.push(d)
      continue
    }
    const s = next[slot.dayIndex][slot.meal]!
    const list = [...s.dishes]
    list[slot.at] = d.recipe
      ? ({ kind: 'recipe', recipeId: d.recipe.id, recipeName: d.recipe.name, course: 'main' } as RecipeDish)
      : { kind: 'note', text: d.dish.trim().slice(0, 120) }
    next[slot.dayIndex] = { ...next[slot.dayIndex], [slot.meal]: { ...s, dishes: list } }
    usedDays.add(slot.dayIndex)
    if (d.recipe) where.set(d.recipe.id, { dayIndex: slot.dayIndex, meal: slot.meal })
    placed.push({ dish: d.dish, dayIndex: slot.dayIndex, meal: slot.meal, ...(d.recipe ? { recipeName: d.recipe.name } : {}) })
  }
  return { days: next, placed, left }
}
