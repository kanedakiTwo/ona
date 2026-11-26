/**
 * The plantilla as it was kept in `user_settings.template` before the
 * «semana tipo» (D-182): the menu reads the week type now, and these parsers
 * only feed its migration (`weekType.ts`) and the old tests.
 */
import type { DayTemplate, Meal, MealDishCounts } from '@ona/shared'

/**
 * Lunch + dinner every day, until the user sets their own plantilla in the
 * profile. Breakfast is opt-in: few households plan it, and with breakfast on
 * by default most new menus came back with `no_main_available_breakfast_*`
 * warnings and empty breakfast slots.
 */
export function defaultTemplate(): DayTemplate[] {
  return Array.from({ length: 7 }, () => ({
    lunch: true,
    dinner: true,
  }))
}

// Frontend ↔ backend meal-template shapes.
//
// The profile page stores `userSettings.template` as a junk-drawer blob:
//   { physical, preferences, mealTemplate: { [day]: string[] } }
// where day is a Spanish weekday ('lunes'…'domingo') and the values are
// Spanish meal names ('desayuno' | 'almuerzo' | 'merienda' | 'cena').
//
// The menu generator wants a 7-entry `DayTemplate[]` with the canonical
// enum keys ('breakfast' | 'lunch' | 'snack' | 'dinner'). Without this
// translation the cast `as DayTemplate[]` silently returns an object,
// `.length` is undefined, and every menu falls back to the default
// (all three meals on every day) — which is the bug Miguel hit when his
// "no breakfasts" preferences kept producing breakfasts anyway.
const SPANISH_DAY_INDEX: Record<string, number> = {
  lunes: 0, martes: 1, miercoles: 2, miércoles: 2, jueves: 3,
  viernes: 4, sabado: 5, sábado: 5, domingo: 6,
}
const SPANISH_TO_MEAL: Record<string, Meal> = {
  desayuno: 'breakfast',
  almuerzo: 'lunch',
  comida: 'lunch',
  merienda: 'snack',
  cena: 'dinner',
}

/**
 * Coerce whatever `userSettings.template` actually contains into a 7-day
 * `DayTemplate[]`. Returns null when the input carries no usable shape so
 * the caller can fall back to `defaultTemplate()`.
 *
 * Accepts three input shapes (in order of precedence):
 *   1. Legacy `DayTemplate[]` (already the right shape).
 *   2. `{ mealTemplate: { [Spanish day]: Spanish meal[] } }` — pure on/off.
 *   3. `{ mealTemplate: { [Spanish day]: { [Spanish meal]: number } } }` —
 *      the post-2026-05-30 shape that also carries per-slot diner counts.
 *      We accept any positive number here; the 0/absent meaning "off" is
 *      enforced by the UI's stepper component, but we also treat 0 as off
 *      defensively so historical writes can't accidentally enable a slot.
 */
export function normalizeMealTemplate(raw: unknown): DayTemplate[] | null {
  if (Array.isArray(raw) && raw.length === 7) {
    // Legacy DayTemplate[] — already the right shape.
    return raw as DayTemplate[]
  }
  // `mealTemplate` lives either at the top level or nested inside the
  // profile page's junk-drawer blob ({ physical, preferences, mealTemplate }).
  const blob = raw as { mealTemplate?: unknown } | null
  const mt = blob && typeof blob === 'object' ? blob.mealTemplate : null
  if (!mt || typeof mt !== 'object') return null

  const out: DayTemplate[] = Array.from({ length: 7 }, () => ({}))
  let anySlot = false
  for (const [dayKey, meals] of Object.entries(mt)) {
    const idx = SPANISH_DAY_INDEX[dayKey.toLowerCase()]
    if (idx == null) continue
    if (Array.isArray(meals)) {
      for (const meal of meals) {
        const canonical = SPANISH_TO_MEAL[String(meal).toLowerCase()]
        if (canonical) {
          out[idx][canonical] = true
          anySlot = true
        }
      }
    } else if (meals && typeof meals === 'object') {
      for (const [mealKey, count] of Object.entries(meals as Record<string, unknown>)) {
        const canonical = SPANISH_TO_MEAL[mealKey.toLowerCase()]
        if (!canonical) continue
        const n = typeof count === 'number' ? count : NaN
        if (Number.isFinite(n) && n > 0) {
          out[idx][canonical] = true
          anySlot = true
        }
      }
    }
  }
  return anySlot ? out : null
}

/**
 * Per-slot diner counts paired with `normalizeMealTemplate`'s output.
 *
 * Returns a 7-entry array (indexed 0=Monday…6=Sunday); each entry maps a
 * canonical meal key ('breakfast' | 'lunch' | 'snack' | 'dinner') to the
 * positive integer of diners the user wants in that slot. Missing entries
 * mean "use the household default" (the same fallback applied to slots
 * generated without any template input).
 *
 * Accepts the same input shapes as `normalizeMealTemplate`; legacy on/off
 * shapes produce an empty result so callers fall back to the household
 * multiplier untouched.
 */
export function extractMealDiners(raw: unknown): Record<Meal, number>[] {
  const out: Record<Meal, number>[] = Array.from(
    { length: 7 },
    () => ({}) as Record<Meal, number>,
  )
  const blob = raw as { mealTemplate?: unknown } | null
  const mt = blob && typeof blob === 'object' ? blob.mealTemplate : null
  if (!mt || typeof mt !== 'object') return out
  for (const [dayKey, meals] of Object.entries(mt)) {
    const idx = SPANISH_DAY_INDEX[dayKey.toLowerCase()]
    if (idx == null || !meals || typeof meals !== 'object' || Array.isArray(meals)) {
      continue
    }
    for (const [mealKey, count] of Object.entries(meals as Record<string, unknown>)) {
      const canonical = SPANISH_TO_MEAL[mealKey.toLowerCase()]
      if (!canonical) continue
      const n = typeof count === 'number' ? count : NaN
      if (Number.isFinite(n) && n > 0) {
        out[idx][canonical] = Math.floor(n)
      }
    }
  }
  return out
}

/**
 * Per-meal-type dish count, parsed from userSettings.template's junk-drawer
 * blob: `{ mealDishCounts: { breakfast?: 1|2|3, lunch?: 1|2|3, ... } }`.
 * Missing entries default to 1 in `dishCountFor`. Invalid values (anything
 * outside 1/2/3) are dropped.
 */
export function extractMealDishCounts(raw: unknown): MealDishCounts {
  if (!raw || typeof raw !== 'object') return {}
  const blob = raw as { mealDishCounts?: unknown }
  const mdc = blob.mealDishCounts
  if (!mdc || typeof mdc !== 'object') return {}
  const out: MealDishCounts = {}
  for (const [meal, count] of Object.entries(mdc as Record<string, unknown>)) {
    if (count === 1 || count === 2 || count === 3) {
      out[meal as keyof MealDishCounts] = count
    }
  }
  return out
}
