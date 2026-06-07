import type { Dish, MealDishCounts, Course, Meal } from '@ona/shared'

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
        }
      : {
          ...current,
          ...(patch.text !== undefined && { text: patch.text }),
        }
  return [...dishes.slice(0, index), next, ...dishes.slice(index + 1)]
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
