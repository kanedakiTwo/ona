/**
 * PRO-387: what this device knows of the week's next steps, for
 * `pickNextStepCard` (lib/nextStep.ts). Kept in localStorage per week (the
 * list) or per day (yesterday's dinner), so a card that was answered or put
 * off doesn't come back until the next week / day.
 *
 * - `markListUsed(weekStart)`: the list of that week was sent or used
 *   (an item ticked, «Mandar la lista» tapped) or put off with «Ahora no».
 * - `markLastNightAnswered(date)`: «¿Qué tal la cena de ayer?» answered or put off today.
 */
import type { DayMenu, MealSlot } from "@ona/shared"

const LIST_KEY = (weekStart: string) => `ona.list.used.${weekStart}`
const LAST_NIGHT_KEY = (date: string) => `ona.lastNight.answered.${date}`

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1"
  } catch {
    return false
  }
}

function write(key: string) {
  try {
    localStorage.setItem(key, "1")
  } catch {
    /* private mode: the card may show once more */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WEEK_STEPS_EVENT))
}

/** Fired on every mark, so /menu re-reads without a reload. */
export const WEEK_STEPS_EVENT = "ona:week-steps"

/** Local-time Monday of `d` as `YYYY-MM-DD`. */
export function mondayOfDate(d: Date): string {
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return localIsoDate(monday)
}

export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function listUsed(weekStart: string): boolean {
  return read(LIST_KEY(weekStart))
}

export function markListUsed(weekStart: string = mondayOfDate(new Date())) {
  if (!listUsed(weekStart)) write(LIST_KEY(weekStart))
}

export function lastNightAnswered(date: string): boolean {
  return read(LAST_NIGHT_KEY(date))
}

export function markLastNightAnswered(date: string) {
  write(LAST_NIGHT_KEY(date))
}

export interface LastNightDish {
  day: number
  meal: "dinner" | "lunch"
  recipeId: string
  recipeName: string
}

/**
 * Pure: yesterday's dinner (or lunch, if there was no dinner) as a catalogue
 * recipe, from this week's days. Null on Monday (yesterday is last week),
 * on a skipped day, or when the dish is a note, a táper or already marked eaten.
 */
export function lastNightDish(days: DayMenu[], todayIndex: number, skippedDays: number[] = []): LastNightDish | null {
  const day = todayIndex - 1
  if (todayIndex < 1 || day > 6 || skippedDays.includes(day)) return null
  const meals = days[day] as Record<string, MealSlot | undefined> | undefined
  for (const meal of ["dinner", "lunch"] as const) {
    const slot = meals?.[meal]
    const dish = slot?.dishes?.[0]
    if (!dish || dish.kind !== "recipe" || !dish.recipeId) continue
    if (slot.eaten || (dish.variant && dish.variant !== "planned")) return null
    return { day, meal, recipeId: dish.recipeId, recipeName: dish.recipeName ?? "" }
  }
  return null
}

/** Pure: something of the week is already marked cooked (a slot eaten, or a cook log since Monday). */
export function weekHasCooked(days: DayMenu[], weekStart: string, lastCookedAt: string | null | undefined): boolean {
  if (days.some((d) => Object.values(d ?? {}).some((slot) => (slot as MealSlot | undefined)?.eaten))) return true
  if (!lastCookedAt) return false
  return new Date(lastCookedAt).getTime() >= new Date(`${weekStart}T00:00:00`).getTime()
}
