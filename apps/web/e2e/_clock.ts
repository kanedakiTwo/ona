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
 * Monday of the current week in Madrid (`YYYY-MM-DD`, the menu's `weekStart`)
 * and the pinned day of that week at 12:00 Madrid (10:00 UTC in summer time,
 * 11:00 in winter: midday either way, far from any day boundary).
 */
export function pinnedDay(weekday = pinnedWeekday()): { weekStart: string; dayIdx: number; at: Date } {
  const todayMadrid = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
  const today = new Date(`${todayMadrid}T10:00:00Z`)
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
