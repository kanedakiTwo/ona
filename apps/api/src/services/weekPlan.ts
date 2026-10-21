import type { DayTemplate, Meal, WeekPlan } from '@ona/shared'

/**
 * PRO-225 · «Antes de planificar». Applies the answers to «¿Alguna comida
 * fuera de casa?» / «¿Viene alguien?» to the week being generated:
 *   - a meal out drops that slot from this week's template (the whole day
 *     when no meal is given);
 *   - guests set the slot's diners (`servings`, «Solo hoy: N»), so the list
 *     and the recipe scale to them;
 *   - `diners` (PRO-275, «esta semana somos dos») sets the diners of every
 *     meal of the week; per-day guests win over it.
 * Pure: returns copies, the saved plantilla (`user_settings.template`) is
 * never touched, so next week follows the usual preferences.
 * Guests on a meal that the template doesn't have add that slot (they come
 * to eat, so there is something to cook); guests on a meal out are ignored.
 * A locked slot («Fijada») is never dropped: the lock means «don't touch».
 */
export function applyWeekPlan(
  template: DayTemplate[],
  mealDiners: Record<Meal, number>[],
  plan: WeekPlan | null | undefined,
  isLocked: (day: number, meal: Meal) => boolean = () => false,
): { template: DayTemplate[]; mealDiners: Record<Meal, number>[] } {
  const tpl = template.map((d) => ({ ...d }))
  const diners = Array.from({ length: tpl.length }, (_, i) => ({ ...(mealDiners[i] ?? {}) }) as Record<Meal, number>)
  if (!plan) return { template: tpl, mealDiners: diners }

  if (typeof plan.diners === 'number' && plan.diners > 0) {
    tpl.forEach((day, i) => {
      for (const m of Object.keys(day) as Meal[]) if (day[m]) diners[i][m] = plan.diners!
    })
  }

  for (const g of plan.guests ?? []) {
    const day = tpl[g.day]
    if (!day) continue
    const meals = g.meal ? [g.meal] : (Object.keys(day).filter((m) => day[m]) as Meal[])
    for (const m of meals) {
      day[m] = true
      diners[g.day][m] = g.diners
    }
  }
  for (const o of plan.mealsOut ?? []) {
    const day = tpl[o.day]
    if (!day) continue
    const meals = o.meal ? [o.meal] : (Object.keys(day) as Meal[])
    for (const m of meals) {
      if (isLocked(o.day, m)) continue
      day[m] = false
      delete diners[o.day][m]
    }
  }
  return { template: tpl, mealDiners: diners }
}

const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MEAL_NAMES: Record<Meal, string> = { breakfast: 'desayuno', lunch: 'comida', dinner: 'cena', snack: 'merienda' }

/** «sin la cena del jueves; sábado: 6 comensales» — for Mimo's summary. */
export function describeWeekPlan(plan: WeekPlan | null | undefined): string {
  const parts: string[] = []
  if (plan?.diners) parts.push(`toda la semana: ${plan.diners} ${plan.diners === 1 ? 'comensal' : 'comensales'}`)
  for (const o of plan?.mealsOut ?? []) {
    parts.push(o.meal ? `sin la ${MEAL_NAMES[o.meal]} del ${DAY_NAMES[o.day]}` : `sin cocinar el ${DAY_NAMES[o.day]}`)
  }
  for (const g of plan?.guests ?? []) {
    parts.push(`${g.meal ? `${MEAL_NAMES[g.meal]} del ` : ''}${DAY_NAMES[g.day]}: ${g.diners} comensales`)
  }
  // PRO-229: what's left in the fridge (saved in the despensa, weighs in the menu).
  if (plan?.fridge?.length) parts.push(`en la nevera: ${plan.fridge.join(', ')}`)
  return parts.join('; ')
}
