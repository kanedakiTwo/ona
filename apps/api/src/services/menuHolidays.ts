/**
 * Festivos en el menú (PRO-226, D-069). A national or regional holiday of the
 * household's comunidad autónoma (memory key `region`) is cooked like a
 * weekend day: on a Monday–Friday holiday the day's time limit becomes
 * Saturday's (none, unless the household set one for Saturdays). Local
 * holidays are not in the table yet (they are published per town).
 */
import { EVERYDAY_WORK_MINUTES, SPANISH_REGIONS, isSpanishRegion, timeBudgetsByDay, weekHolidays, type DayTimeBudget, type SpanishRegion, type WeekPlanGuests } from '@ona/shared'

const SATURDAY = 5

export interface WeekHoliday {
  dayIndex: number
  date: string
  name: string
}

/** The household's region from a memory value, or null. */
export function regionFromMemory(value: unknown): SpanishRegion | null {
  return isSpanishRegion(value) ? value : null
}

/**
 * Pure: the week's time limits with its weekday holidays treated as weekend.
 * Returns a new map (the input is not touched) and the holidays it found.
 */
export function holidayTimeBudgets(
  budgets: Record<number, DayTimeBudget>,
  weekStart: string,
  region: SpanishRegion | null | undefined,
): { budgets: Record<number, DayTimeBudget>; holidays: WeekHoliday[] } {
  const holidays = weekHolidays(weekStart, region)
  if (holidays.length === 0) return { budgets, holidays }
  const out: Record<number, DayTimeBudget> = { ...budgets }
  for (const h of holidays) {
    if (h.dayIndex >= SATURDAY) continue
    const weekend = budgets[SATURDAY]
    if (weekend) out[h.dayIndex] = { ...weekend }
    else delete out[h.dayIndex]
  }
  return { budgets: out, holidays }
}

/** Was the day's limit lifted (or loosened) because of the holiday? */
export function holidayRelaxedDay(before: Record<number, DayTimeBudget>, after: Record<number, DayTimeBudget>, dayIndex: number): boolean {
  const b = before[dayIndex]
  if (!b) return false
  const a = after[dayIndex]
  return !a || a.mode !== b.mode || a.minutes > b.minutes
}

/**
 * One day's limit for the single-slot paths (Cambiar al azar, add a meal,
 * regenerate a dish), with the same holiday rule as the weekly generator.
 */
export function slotTimeBudget(
  memory: { time_available?: { value?: unknown }; region?: { value?: unknown } } | null | undefined,
  weekStart: string | Date | null | undefined,
  dayIndex: number,
): DayTimeBudget | null {
  const budgets = timeBudgetsByDay(memory?.time_available?.value)
  if (!weekStart) return budgets[dayIndex] ?? null
  const start = typeof weekStart === 'string' ? weekStart : weekStart.toISOString()
  return holidayTimeBudgets(budgets, start.slice(0, 10), regionFromMemory(memory?.region?.value)).budgets[dayIndex] ?? null
}

/**
 * D-1028 · the everyday work cap of one slot of the weekly draw: 30 min of
 * the cook's time, or none on a special occasion — a holiday of the
 * household's comunidad (Saturdays and Sundays included) or a meal with
 * guests in this week's plan (`weekPlan.guests`; a guest entry without a
 * meal covers the whole day). Pure.
 */
export function workCapForSlot(
  dayIndex: number,
  meal: string,
  special: { holidayDays?: ReadonlySet<number>; guests?: readonly WeekPlanGuests[] | null },
): number | null {
  if (special.holidayDays?.has(dayIndex)) return null
  if (special.guests?.some((g) => g.day === dayIndex && (!g.meal || g.meal === meal))) return null
  return EVERYDAY_WORK_MINUTES
}

/**
 * D-1028 · the same cap for the single-slot paths (Cambiar al azar, add a
 * meal or a dish, regenerate a dish): none on a holiday of the household's
 * comunidad. The menu row doesn't keep the week's guests, so a meal with
 * guests changed later keeps the cap.
 */
export function slotWorkCap(
  memory: { region?: { value?: unknown } } | null | undefined,
  weekStart: string | Date | null | undefined,
  dayIndex: number,
): number | null {
  if (!weekStart) return EVERYDAY_WORK_MINUTES
  const start = (typeof weekStart === 'string' ? weekStart : weekStart.toISOString()).slice(0, 10)
  const holidayDays = new Set(weekHolidays(start, regionFromMemory(memory?.region?.value)).map((h) => h.dayIndex))
  return workCapForSlot(dayIndex, '', { holidayDays })
}

/**
 * For Mimo's tool result after generating a week (web chat and WhatsApp):
 * «Festivos de esta semana en Comunidad de Madrid: jueves (Fiesta…)…», so it
 * can mention them. Null without a region or a holiday; never throws.
 */
export async function weekHolidaySummary(userId: string, weekStart: string): Promise<string | null> {
  try {
    const { getMemoryForUser } = await import('./userMemoryStore.js')
    const memory = await getMemoryForUser(userId)
    const region = regionFromMemory(memory?.region?.value)
    const holidays = weekHolidays(weekStart, region)
    if (!region || holidays.length === 0) return null
    const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
    const list = holidays.map((h) => `${DAYS[h.dayIndex]} (${h.name})`).join(', ')
    return `Festivos de esa semana en ${SPANISH_REGIONS[region]}: ${list}. Esos días el menú va como en fin de semana, con más calma; díselo en una frase («el jueves es festivo: te he puesto algo con más calma»).`
  } catch {
    return null
  }
}
