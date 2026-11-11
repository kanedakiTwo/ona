import type { DayMenu, MealSlot } from '../types/menu.js'
import type { Dish } from '../types/menuDish.js'

/**
 * Pure: moves the slot `from` to `to` in a week (or swaps them when `to` has
 * dishes). Each slot travels whole («Solo hoy» included), and the leftovers
 * that point at a moved slot (`leftoverOf`) point at its new place, so the
 * dish still cooks the táper (PRO-102: Laura moved Monday's curry for 2 with
 * leftovers to Thursday and its batch lost the leftover's servings). Returns
 * a new array; the input isn't mutated.
 *
 * Shared (2026-11-10) by `POST /menu/:id/move-slot` and the web's drag and
 * drop, which draws the move before the server answers.
 */
export function moveSlotInWeek(
  days: DayMenu[],
  from: { day: number; meal: string },
  to: { day: number; meal: string },
): DayMenu[] {
  const next: DayMenu[] = days.map((d) => ({ ...(d ?? {}) }))
  const source = next[from.day]?.[from.meal]
  const target = next[to.day]?.[to.meal]
  const swap = !!target && Array.isArray(target.dishes) && target.dishes.length > 0
  next[to.day] = next[to.day] ?? {}
  next[to.day][to.meal] = source
  if (swap) next[from.day][from.meal] = target
  else delete next[from.day][from.meal]

  const repoint = (ref: { day: number; meal: string }) => {
    if (ref.day === from.day && ref.meal === from.meal) return to
    if (swap && ref.day === to.day && ref.meal === to.meal) return from
    return null
  }
  for (const day of next) {
    for (const meal of Object.keys(day)) {
      const slot = day[meal]
      if (!slot || !Array.isArray(slot.dishes)) continue
      let changed = false
      const dishes = slot.dishes.map((d) => {
        if (d.kind !== 'recipe' || d.variant !== 'leftover' || !d.leftoverOf) return d
        const moved = repoint(d.leftoverOf)
        if (!moved) return d
        changed = true
        return { ...d, leftoverOf: { ...d.leftoverOf, day: moved.day, meal: moved.meal } }
      })
      if (changed) day[meal] = { ...slot, dishes }
    }
  }
  return next
}

/**
 * What a change by position expects to find (2026-11-10). The web draws its
 * changes at once and sends them one after the other; if one fails, the next
 * one's «position 1» may no longer be the dish the person touched. Each such
 * request carries the dish (`dishKey`) or the meal (`slotKey`) it saw, and the
 * route answers 409 `MENU_CHANGED` when the week no longer has it there.
 */
export function dishKey(dish: Dish | null | undefined): string {
  if (!dish) return '∅'
  return dish.kind === 'recipe' ? `r:${dish.recipeId}` : `n:${dish.text}`
}

/** The whole meal: its dishes in order, `∅` when the day doesn't have it. */
export function slotKey(slot: MealSlot | null | undefined): string {
  if (!slot) return '∅'
  return `[${(slot.dishes ?? []).map(dishKey).join('|')}]`
}

/** Error code of the 409 a route answers when the expectation doesn't hold. */
export const MENU_CHANGED_CODE = 'MENU_CHANGED'
