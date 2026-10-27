/**
 * PRO-142: specs that depend on «today» pin the browser clock to a fixed
 * weekday of the current week, so they behave the same whatever day CI runs
 * them (the menu specs used to fail from Friday to Sunday).
 *
 * The day is `E2E_WEEKDAY` (0 = Monday … 6 = Sunday) or, by default, Friday,
 * the day that broke them. To check every day locally:
 *   for d in 0 1 2 3 4 5 6; do E2E_WEEKDAY=$d pnpm exec playwright test menu-; done
 */

import type { Page } from '@playwright/test'

const DEFAULT_WEEKDAY = 4

/** `YYYY-MM-DD` of a UTC date. */
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** The pinned weekday index (0 = Monday). */
export function pinnedWeekday(): number {
  const raw = Number(process.env.E2E_WEEKDAY ?? DEFAULT_WEEKDAY)
  return Number.isInteger(raw) && raw >= 0 && raw <= 6 ? raw : DEFAULT_WEEKDAY
}

/**
 * Today in Madrid (`YYYY-MM-DD`), not in the process clock: CI runs in UTC,
 * and from 00:00 to 02:00 Madrid (01:00 in winter) the two disagree on the
 * day (PRO-272, PRO-273). Use these, never `new Date().getDay()` & co.
 */
export function madridToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now)
}

/** Index of today in Madrid within its week (0 = Monday … 6 = Sunday). */
export function madridTodayIdx(now = new Date()): number {
  return (new Date(`${madridToday(now)}T12:00:00Z`).getUTCDay() + 6) % 7
}

/** Monday of the current week in Madrid (`YYYY-MM-DD`, the menu's `weekStart`). */
export function madridWeekStart(now = new Date()): string {
  return pinnedDay(0, now).weekStart
}

/**
 * Monday `weeks` weeks after this one in Madrid (`YYYY-MM-DD`; 0 = this
 * week). Never from `new Date().getDay()` in the runner: CI runs in UTC, and
 * on Monday from 00:00 to 02:00 Madrid (01:00 in winter) the runner is still
 * on Sunday, a week behind the app.
 */
export function madridMondayIn(weeks: number, now = new Date()): string {
  const monday = new Date(`${madridWeekStart(now)}T10:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() + 7 * weeks)
  return iso(monday)
}

/**
 * A day of the pinned week for dishes that must reach the shopping list from
 * the pinned day at any hour: the day after the pinned one, or the pinned day
 * itself when the day after is Madrid's real «today». The API trims the meals
 * of its own «today» that are already past (lunch from 16:00, dinner from
 * 23:00 Madrid) and `pinClock` does not reach it; the pinned week is always
 * the real one, so only the real «today» can be trimmed. (With
 * `E2E_WEEKDAY=6` it is Sunday itself.)
 */
export function listSafeDay(weekday = pinnedWeekday(), now = new Date()): number {
  const next = weekday < 6 ? weekday + 1 : weekday
  return next === madridTodayIdx(now) ? weekday : next
}

/**
 * Monday of the current week in Madrid (`YYYY-MM-DD`, the menu's `weekStart`)
 * and the pinned day of that week at 12:00 Madrid (10:00 UTC in summer time,
 * 11:00 in winter: midday either way, far from any day boundary).
 */
export function pinnedDay(weekday = pinnedWeekday(), now = new Date()): { weekStart: string; dayIdx: number; at: Date } {
  const today = new Date(`${madridToday(now)}T10:00:00Z`)
  const monday = new Date(today)
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7))
  const at = new Date(monday)
  at.setUTCDate(monday.getUTCDate() + weekday)
  return { weekStart: iso(monday), dayIdx: weekday, at }
}

/** Pin the page's clock (Madrid time zone set by the spec) to the pinned day. */
export async function pinClock(page: Page, weekday = pinnedWeekday()) {
  const day = pinnedDay(weekday)
  await page.clock.setFixedTime(day.at)
  return day
}
