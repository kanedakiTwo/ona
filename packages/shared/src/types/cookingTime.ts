/**
 * Time to cook per weekday (PRO-138). «Una cosa es tener poco tiempo para
 * cocinar y otra poco tiempo para dedicar»: a day's limit is either on the
 * recipe's total time («en media hora, a la mesa») or on the hands-on time
 * («poco rato de trabajo, aunque luego se haga solo»).
 *
 * Stored in the `time_available` memory fact, one entry per weekday:
 *   - a plain number (the original shape, still written by Mimo) = total
 *     minutes;
 *   - `{ mode: 'total' | 'activo', minutes }`.
 * A missing day or 0 minutes = no limit that day.
 */
import { z } from 'zod'

export const COOKING_WEEKDAYS = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
] as const
export type CookingWeekday = (typeof COOKING_WEEKDAYS)[number]

export const TIME_BUDGET_MODES = ['total', 'activo'] as const
export type TimeBudgetMode = (typeof TIME_BUDGET_MODES)[number]

export interface DayTimeBudget {
  mode: TimeBudgetMode
  minutes: number
}

const minutesSchema = z.number().int().min(0).max(480)

/** One weekday's value in `time_available`: minutes (total) or mode + minutes. */
export const dayTimeBudgetSchema = z.union([
  minutesSchema,
  z.object({ mode: z.enum(TIME_BUDGET_MODES), minutes: minutesSchema }),
])

/** Normalise one stored day value. Null = no limit (missing, 0 or malformed). */
export function toDayTimeBudget(raw: unknown): DayTimeBudget | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? { mode: 'total', minutes: raw } : null
  }
  if (raw && typeof raw === 'object') {
    const r = raw as { mode?: unknown; minutes?: unknown }
    const minutes = typeof r.minutes === 'number' && Number.isFinite(r.minutes) ? r.minutes : 0
    if (minutes <= 0) return null
    return { mode: r.mode === 'activo' ? 'activo' : 'total', minutes }
  }
  return null
}

/** The limit for one day (0 = Monday … 6 = Sunday) from a `time_available` value. */
export function dayTimeBudget(timeAvailable: unknown, dayIndex: number): DayTimeBudget | null {
  if (!timeAvailable || typeof timeAvailable !== 'object' || Array.isArray(timeAvailable)) return null
  const key = COOKING_WEEKDAYS[dayIndex]
  if (!key) return null
  return toDayTimeBudget((timeAvailable as Record<string, unknown>)[key])
}

/** Every limited day, indexed 0 (Monday) … 6 (Sunday). */
export function timeBudgetsByDay(timeAvailable: unknown): Record<number, DayTimeBudget> {
  const out: Record<number, DayTimeBudget> = {}
  for (let i = 0; i < COOKING_WEEKDAYS.length; i++) {
    const b = dayTimeBudget(timeAvailable, i)
    if (b) out[i] = b
  }
  return out
}

/** «15 min de trabajo» / «30 min en total». */
export function formatDayTimeBudget(b: DayTimeBudget): string {
  return b.mode === 'activo' ? `${b.minutes} min de trabajo` : `${b.minutes} min en total`
}

// ─── The onboarding question ─────────────────────────────────────

/**
 * «Entre semana, ¿cómo te gusta cocinar?» — one tap in the onboarding.
 * The weekend is «sin prisa» by default.
 */
export const WEEKDAY_COOKING_CHOICES = ['rapido', 'poco_trabajo', 'sin_prisa'] as const
export type WeekdayCookingChoice = (typeof WEEKDAY_COOKING_CHOICES)[number]

/** «Rápido»: total ≤ 30 min. */
export const QUICK_TOTAL_MINUTES = 30
/** «Poco rato de trabajo»: hands-on ≤ 20 min, total free. */
export const LITTLE_WORK_ACTIVE_MINUTES = 20

/**
 * The `time_available` value an onboarding answer stores. «Sin prisa» is an
 * empty object: an explicit «no limit» (so the «Rapidez» fallback doesn't
 * cap the week either).
 */
export function timeAvailableForChoice(choice: WeekdayCookingChoice): Partial<Record<CookingWeekday, DayTimeBudget>> {
  if (choice === 'sin_prisa') return {}
  const budget: DayTimeBudget =
    choice === 'rapido'
      ? { mode: 'total', minutes: QUICK_TOTAL_MINUTES }
      : { mode: 'activo', minutes: LITTLE_WORK_ACTIVE_MINUTES }
  const out: Partial<Record<CookingWeekday, DayTimeBudget>> = {}
  for (const d of COOKING_WEEKDAYS.slice(0, 5)) out[d] = { ...budget }
  return out
}

// ─── Recipe side ──────────────────────────────────────────────────

export interface RecipeTimes {
  prepTime?: number | null
  cookTime?: number | null
  activeTime?: number | null
  totalTime?: number | null
}

const positive = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** Total time: `totalTime`, else `prepTime + cookTime` (null when neither is known). */
export function recipeTotalMinutes(r: RecipeTimes): number | null {
  if (positive(r.totalTime)) return r.totalTime
  if (positive(r.prepTime) || positive(r.cookTime)) return (r.prepTime ?? 0) + (r.cookTime ?? 0)
  return null
}

/** Hands-on time: `activeTime`, else `prepTime` (null when neither is known). */
export function recipeActiveMinutes(r: RecipeTimes): number | null {
  if (positive(r.activeTime)) return r.activeTime
  if (positive(r.prepTime)) return r.prepTime
  return null
}

/**
 * Does a recipe fit a day's limit? No limit → always. With a limit, the
 * recipe needs the time that limit is about (total or hands-on): a recipe
 * without it does not pass.
 */
export function fitsTimeBudget(r: RecipeTimes, budget: DayTimeBudget | null | undefined): boolean {
  if (!budget || budget.minutes <= 0) return true
  const minutes = budget.mode === 'activo' ? recipeActiveMinutes(r) : recipeTotalMinutes(r)
  return minutes != null && minutes <= budget.minutes
}
