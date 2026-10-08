/**
 * Pure view helpers for the /menu "D · Luz y foto" layout.
 *
 * No React, no `@/` aliases: this file is imported by the API's vitest
 * suite (`apps/api/src/tests/menuDayView.test.ts`) through a relative path,
 * so keep it dependency-free apart from `@ona/shared` types.
 */
import type { DayMenu, Dish, MealSlot, RecipeDish } from "@ona/shared"

export type MealKey = "breakfast" | "lunch" | "snack" | "dinner"

/** Chronological order of a day's meals (merienda before cena). */
export const DAY_MEAL_ORDER: MealKey[] = ["breakfast", "lunch", "snack", "dinner"]

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]
const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
const WEEKDAYS_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
/** One-letter day initials used by the day strip (X = miércoles, Spanish convention). */
export const DAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"]

function parseLocal(weekStart: string): Date {
  const [y, m, d] = weekStart.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Date (local) of day `i` (0 = Monday) of the week starting `weekStart`. */
export function dateOfDay(weekStart: string, i: number): Date {
  const d = parseLocal(weekStart)
  d.setDate(d.getDate() + i)
  return d
}

/**
 * "Semana del 5 al 11 de octubre", "Semana del 28 de septiembre al 4 de
 * octubre", "Semana del 29 de diciembre al 4 de enero".
 */
export function weekRangeLabel(weekStart: string): string {
  const start = dateOfDay(weekStart, 0)
  const end = dateOfDay(weekStart, 6)
  if (start.getMonth() === end.getMonth()) {
    return `Semana del ${start.getDate()} al ${end.getDate()} de ${MONTHS[end.getMonth()]}`
  }
  return `Semana del ${start.getDate()} de ${MONTHS[start.getMonth()]} al ${end.getDate()} de ${MONTHS[end.getMonth()]}`
}

export interface DayHeading {
  /** Plain lead-in, e.g. "Hoy, " / "Mañana, " / "" */
  lead: string
  /** Italic terracotta part, e.g. "jueves" / "Viernes" */
  accent: string
  /** Trailing plain part, e.g. " 9" (empty for today on mobile) */
  tail: string
}

/**
 * Heading for the selected day.
 *   today            → "Hoy, *jueves*"        (withDate: "Hoy, *jueves 8*")
 *   today + 1        → "Mañana, *viernes*"     (withDate: "Mañana, *viernes 9*")
 *   any other day    → "*Viernes* 9"
 */
export function dayHeading(
  weekStart: string,
  dayIndex: number,
  todayIndex: number,
  opts: { withDate?: boolean } = {},
): DayHeading {
  const date = dateOfDay(weekStart, dayIndex).getDate()
  const name = WEEKDAYS[dayIndex] ?? ""
  const dated = opts.withDate ? `${name} ${date}` : name
  if (todayIndex >= 0 && dayIndex === todayIndex) return { lead: "Hoy, ", accent: dated, tail: "" }
  if (todayIndex >= 0 && dayIndex === todayIndex + 1) return { lead: "Mañana, ", accent: dated, tail: "" }
  return { lead: "", accent: name.charAt(0).toUpperCase() + name.slice(1), tail: ` ${date}` }
}

/** "Lun 5" / "Hoy, jue 8" — the day label of a desktop week column. */
export function weekColumnLabel(weekStart: string, dayIndex: number, todayIndex: number): string {
  const date = dateOfDay(weekStart, dayIndex).getDate()
  const short = WEEKDAYS_SHORT[dayIndex] ?? ""
  if (dayIndex === todayIndex) return `Hoy, ${short} ${date}`
  return `${short.charAt(0).toUpperCase()}${short.slice(1)} ${date}`
}

/** Full weekday name, lower-case ("viernes"). */
export function weekdayName(dayIndex: number): string {
  return WEEKDAYS[dayIndex] ?? ""
}

export function firstRecipeDish(slot: MealSlot | undefined | null): RecipeDish | null {
  const dishes: Dish[] = slot?.dishes ?? []
  return (dishes.find((d) => d.kind === "recipe") as RecipeDish | undefined) ?? null
}

export interface DaySlot {
  meal: MealKey
  slot: MealSlot
}

/** The day's slots that exist (template-active), in chronological order. */
export function orderedSlots(day: DayMenu | undefined | null): DaySlot[] {
  if (!day) return []
  return DAY_MEAL_ORDER.filter((m) => day[m] != null).map((m) => ({
    meal: m,
    slot: day[m] as MealSlot,
  }))
}

/**
 * Split a day into the featured meal (the first one, in chronological
 * order, that has a recipe — it gets the photo hero and "Empezar a
 * cocinar") and the rest, which keep their chronological order. A day
 * with no recipe at all has no featured meal.
 */
export function splitDay(day: DayMenu | undefined | null): { featured: DaySlot | null; rest: DaySlot[] } {
  const slots = orderedSlots(day)
  const featured = slots.find((s) => firstRecipeDish(s.slot) != null) ?? null
  return { featured, rest: slots.filter((s) => s !== featured) }
}

/** Meals the day doesn't have yet (what "Añadir comida" can create). */
export function missingMeals(day: DayMenu | undefined | null): MealKey[] {
  return DAY_MEAL_ORDER.filter((m) => !day || day[m] == null)
}

/** Minutes shown for a slot: the first recipe's total time, else its prep time. */
export function slotMinutes(slot: MealSlot | undefined | null): number | null {
  const r = firstRecipeDish(slot)
  const v = r?.totalTime ?? r?.prepTime ?? null
  return v != null && v > 0 ? v : null
}

/** "Comida · 28 min · 3 raciones" (parts that are unknown are skipped). */
export function mealEyebrow(label: string, minutes: number | null, servings?: number | null): string {
  const parts = [label]
  if (minutes != null && minutes > 0) parts.push(`${minutes} min`)
  if (servings != null && servings > 0) parts.push(`${servings} ${servings === 1 ? "ración" : "raciones"}`)
  return parts.join(" · ")
}

/** True when at least one slot of the week holds a dish. */
export function weekHasDishes(days: (DayMenu | undefined | null)[] | undefined | null): boolean {
  return (days ?? []).some((day) =>
    Object.values(day ?? {}).some((slot) => ((slot as MealSlot | undefined)?.dishes?.length ?? 0) > 0),
  )
}
