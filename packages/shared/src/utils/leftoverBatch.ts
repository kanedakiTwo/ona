import type { DayMenu, MealSlot } from '../types/menu.js'
import type { RecipeDish } from '../types/menuDish.js'

/**
 * How many rations a cooked meal makes when other meals of the week eat its
 * leftovers (PRO-75, PRO-223, PRO-298). One rule for the shopping list
 * (`withLeftoverBatches` in the API), the menu page («N raciones», the recipe
 * and cook links: `batchServings`) and Mimo's menu facts (`mealServings`).
 *
 * - The source meal's own diners: its «Solo hoy: N» (`servings`), else the
 *   household's.
 * - When N is not above the household (it's just who eats that meal, often
 *   the weekly template's diners put there by the generator), every leftover
 *   adds its own diners. PRO-298: Dani y Sara's bowl, Monday «Solo hoy: 2»
 *   (the template's 2) with leftovers Tuesday to Thursday, bought for 2
 *   instead of 8.
 * - When N is above the household, N already counts tápers (PRO-75, option
 *   A: Laura alone, lasaña «Solo hoy: 2» + sobras → 2), but the batch never
 *   falls below the household eating every meal it covers:
 *   max(N, household + each leftover's diners). A leftover saved before
 *   PRO-75 copied the source's N; that copy counts as the household's.
 * - A táper for tomorrow (PRO-223, slot with `taper`) is always on top.
 */
export function leftoverShares(
  sourceOverride: number | null,
  household: number,
  leftoverDiners: ReadonlyArray<number | null>,
): number[] {
  const own = sourceOverride ?? household
  if (own <= household) return leftoverDiners.map((d) => d ?? household)
  let covered = own - household
  return leftoverDiners.map((d) => {
    const diners = d != null && d !== own ? d : household
    const used = Math.min(covered, diners)
    covered -= used
    return diners - used
  })
}

/** The slot's «Solo hoy: N», or null. */
export function slotServingsOverride(slot: MealSlot | null | undefined): number | null {
  return typeof slot?.servings === 'number' && slot.servings > 0 ? slot.servings : null
}

function firstRecipeDish(slot: MealSlot | null | undefined): RecipeDish | undefined {
  return slot?.dishes?.find((d): d is RecipeDish => d.kind === 'recipe')
}

/**
 * Rations the menu shows for a meal and opens its recipe at: the whole batch,
 * leftovers and tápers included. A leftover slot counts only its own diners
 * (it isn't cooked again).
 */
export function batchServingsOf(
  days: ReadonlyArray<DayMenu | null | undefined>,
  day: number,
  meal: string,
  household: number,
): number {
  const slot = days[day]?.[meal as keyof DayMenu]
  const override = slotServingsOverride(slot)
  const own = override ?? household
  const first = firstRecipeDish(slot)
  if (!first || first.variant === 'leftover') return own
  let tapers = 0
  const leftovers: Array<number | null> = []
  for (const d of days) {
    for (const s of Object.values(d ?? {}) as (MealSlot | undefined)[]) {
      const dish = firstRecipeDish(s)
      if (
        dish?.variant !== 'leftover' ||
        dish.recipeId !== first.recipeId ||
        dish.leftoverOf?.day !== day ||
        dish.leftoverOf?.meal !== meal
      ) continue
      if (s?.taper) tapers += s.taper
      else leftovers.push(slotServingsOverride(s))
    }
  }
  return own + tapers + leftoverShares(override, household, leftovers).reduce((a, b) => a + b, 0)
}
