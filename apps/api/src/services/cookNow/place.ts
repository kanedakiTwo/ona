/**
 * «Cocinar esta» (specs/cook-now.md → §4), pure: the chosen recipe replaces
 * every dish of the meal; the planned recipe dishes (plannedRecipeDishes)
 * move to `displacedTo` — same meal, replacing its dishes — or go. Leftovers
 * pointing at the moved slot point at its new place. Locked meals are
 * refused by the route before calling this.
 */
import { isRecipeDish, plannedRecipeDishes, type DayMenu, type RecipeDish } from '@ona/shared'

export function placeCookNowRecipe(
  days: readonly DayMenu[],
  at: { day: number; meal: string },
  dish: RecipeDish,
  servings: number | null,
  displacedTo: number | null,
): DayMenu[] {
  const next: DayMenu[] = structuredClone(days as DayMenu[])
  while (next.length < 7) next.push({})
  const planned = plannedRecipeDishes(next[at.day]?.[at.meal])
  if (displacedTo != null && displacedTo !== at.day && planned.length > 0) {
    const target = next[displacedTo]?.[at.meal]
    const { eaten: _e, eatenAt: _a, ...rest } = target ?? { dishes: [] }
    next[displacedTo] = { ...(next[displacedTo] ?? {}), [at.meal]: { ...rest, dishes: planned } }
    for (const day of next) {
      for (const slot of Object.values(day ?? {})) {
        for (const d of slot?.dishes ?? []) {
          if (isRecipeDish(d) && d.leftoverOf?.day === at.day && d.leftoverOf.meal === at.meal) {
            d.leftoverOf = { ...d.leftoverOf, day: displacedTo }
          }
        }
      }
    }
  }
  next[at.day] = { ...(next[at.day] ?? {}), [at.meal]: { ...(servings != null ? { servings } : {}), dishes: [dish] } }
  return next
}
