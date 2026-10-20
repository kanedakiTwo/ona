import type { Dish, MealDishCounts, Course, Meal, MealSlot, DayMenu } from '@ona/shared'

export function addDish(dishes: Dish[], next: Dish): Dish[] {
  return [...dishes, next]
}

export function removeDishAt(dishes: Dish[], index: number): Dish[] {
  if (index < 0 || index >= dishes.length) {
    throw new Error(`removeDishAt: index ${index} out of range (length ${dishes.length})`)
  }
  return [...dishes.slice(0, index), ...dishes.slice(index + 1)]
}

export function reorderDish(dishes: Dish[], from: number, to: number): Dish[] {
  if (from < 0 || from >= dishes.length || to < 0 || to >= dishes.length) {
    throw new Error(`reorderDish: index out of range`)
  }
  if (from === to) return dishes
  const next = [...dishes]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Patch a single dish. Fields that don't apply to the dish's kind are silently
 * ignored (e.g. `text` on a recipe dish, `pinnedType` on a note dish). This
 * lets the route handler accept a uniform body shape without dispatching on kind.
 */
export interface DishPatch {
  text?: string
  pinnedType?: string | null
  course?: Course | null
  /** «Son sobras de otro día» (`cooked`) on a dish already in the menu (2026-10-20); never on a leftover. */
  variant?: 'planned' | 'freezer' | 'cooked'
}

export function patchDish(dishes: Dish[], index: number, patch: DishPatch): Dish[] {
  if (index < 0 || index >= dishes.length) {
    throw new Error(`patchDish: index ${index} out of range`)
  }
  const current = dishes[index]
  const next: Dish =
    current.kind === 'recipe'
      ? {
          ...current,
          ...(patch.pinnedType !== undefined && { pinnedType: patch.pinnedType }),
          ...(patch.course !== undefined && { course: patch.course }),
          ...(patch.variant !== undefined && current.variant !== 'leftover' && { variant: patch.variant }),
        }
      : {
          ...current,
          ...(patch.text !== undefined && { text: patch.text }),
        }
  return [...dishes.slice(0, index), next, ...dishes.slice(index + 1)]
}

/**
 * True when a leftover somewhere in the week points at this dish: it is the
 * batch that gets cooked, so it can't become a freezer táper (PRO-82).
 */
export function isLeftoverSource(days: DayMenu[], day: number, meal: string, position: number): boolean {
  return days.some((d) =>
    Object.values(d ?? {}).some((slot) =>
      (slot?.dishes ?? []).some(
        (x) =>
          x.kind === 'recipe' &&
          x.variant === 'leftover' &&
          x.leftoverOf?.day === day &&
          x.leftoverOf?.meal === meal &&
          (x.leftoverOf?.dishPosition ?? 0) === position,
      ),
    ),
  )
}

export function dishCountFor(meal: Meal, counts: MealDishCounts): 1 | 2 | 3 {
  return counts[meal] ?? 1
}

/**
 * Convention map: number of dishes → courses to ask the matcher for.
 *   1 → [null]                       (no course constraint; matcher restricts to main/null)
 *   2 → ['starter', 'main']
 *   3 → ['starter', 'main', 'dessert']
 */
export function coursesFor(count: 1 | 2 | 3): (Course | null)[] {
  if (count === 1) return [null]
  if (count === 2) return ['starter', 'main']
  return ['starter', 'main', 'dessert']
}

/**
 * The slot with new dishes, keeping the rest of it — above all `servings`
 * («Solo hoy: N»). PRO-102: changing a dish with Mimo (`swap_meal`) used to
 * write `{ dishes }` alone, and the Ruiz family's «Solo hoy: 4» went back to
 * the household's 5.
 */
export function slotWithDishes(slot: MealSlot | null | undefined, dishes: Dish[]): MealSlot {
  return { ...(slot ?? {}), dishes }
}

/**
 * Pure: moves the slot `from` to `to` in a week (or swaps them when `to` has
 * dishes). Each slot travels whole («Solo hoy» included), and the leftovers
 * that point at a moved slot (`leftoverOf`) point at its new place, so the
 * dish still cooks the táper (PRO-102: Laura moved Monday's curry for 2 with
 * leftovers to Thursday and its batch lost the leftover's servings). Returns
 * a new array; the input isn't mutated.
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
