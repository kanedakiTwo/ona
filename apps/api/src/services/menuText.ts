import type { DayMenu, Dish } from '@ona/shared'

/**
 * Pure: a menu day → Spanish lines the assistant (and WhatsApp messages) can
 * read, e.g. "comida: Lentejas estofadas + Ensalada verde". Understands the
 * multi-dish slot shape (`{ dishes: [...] }`, recipes + free-text notes).
 */

export const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner'] as const
export const MEAL_LABEL_ES: Record<string, string> = {
  breakfast: 'desayuno',
  lunch: 'comida',
  snack: 'merienda',
  dinner: 'cena',
}

function dishLabel(d: Dish): string | null {
  if (d.kind === 'note') return d.text?.trim() || null
  if (d.kind === 'recipe') {
    const name = d.recipeName?.trim() || 'receta sin nombre'
    return d.variant === 'leftover' ? `${name} (sobras)` : name
  }
  return null
}

export function mealEntriesForDay(day: DayMenu | null | undefined): { meal: string; label: string; dishes: string[] }[] {
  if (!day || typeof day !== 'object') return []
  const meals = [
    ...MEAL_ORDER.filter((m) => m in day),
    ...Object.keys(day).filter((m) => !(MEAL_ORDER as readonly string[]).includes(m)),
  ]
  const out: { meal: string; label: string; dishes: string[] }[] = []
  for (const meal of meals) {
    const slot = day[meal]
    const dishes = Array.isArray(slot?.dishes)
      ? slot!.dishes.map(dishLabel).filter((x): x is string => Boolean(x))
      : []
    if (dishes.length > 0) out.push({ meal, label: MEAL_LABEL_ES[meal] ?? meal, dishes })
  }
  return out
}

export function mealLinesForDay(day: DayMenu | null | undefined): string[] {
  return mealEntriesForDay(day).map((e) => `${e.label}: ${e.dishes.join(' + ')}`)
}
