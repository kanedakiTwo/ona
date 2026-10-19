/**
 * PRO-65: signing up on a Sunday used to give a first menu for the week that
 * ends that same day. An onboarding finished Friday to Sunday (Madrid time)
 * now generates the current week and the next, and /menu opens the next.
 * PRO-244: the first menu starts that day — Monday to Friday of the current
 * week are not generated (only Saturday and Sunday have dishes).
 * Mobile (390×844); the browser clock is pinned to the coming Saturday.
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ timezoneId: 'Europe/Madrid', viewport: { width: 390, height: 844 } })

/** The coming Saturday at 12:00 Madrid (10:00 UTC), and its two Mondays. */
function comingSaturday() {
  const d = new Date()
  d.setUTCHours(10, 0, 0, 0)
  do d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCDay() !== 6)
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - 5)
  const nextMonday = new Date(d)
  nextMonday.setUTCDate(d.getUTCDate() + 2)
  return { saturday: d, current: iso(monday), next: iso(nextMonday) }
}

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!)
  return { auth: { Authorization: `Bearer ${token}` }, userId: user.id as string }
}

test('a weekend sign-up gets this week and the next, and /menu opens the next', async ({ page }) => {
  test.setTimeout(120_000)
  const { saturday, current, next: nextWeek } = comingSaturday()
  await page.clock.setFixedTime(saturday)
  await registerFreshUser(page)
  await page.goto('/onboarding')

  const generated: string[] = []
  const fromDates: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/menu/generate')) {
      const body = JSON.parse(req.postData() ?? '{}')
      generated.push(body.weekStart)
      fromDates.push(body.fromDate)
    }
  })

  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  await page.getByRole('button', { name: /3-4 veces/i }).click()
  await next.click()
  // PRO-138: «Entre semana, ¿cómo te gusta cocinar?»
  await page.getByRole('button', { name: /sin prisa/i }).click()
  await next.click()
  await next.click() // no restrictions
  await page.getByRole('button', { name: /salud/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()

  await expect(page).toHaveURL(new RegExp(`/menu\\?week=${nextWeek}`), { timeout: 60_000 })
  expect(generated).toEqual([current, nextWeek])
  await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/tu semana está/i)).toHaveCount(0)

  const saturdayIso = saturday.toISOString().slice(0, 10)
  expect(fromDates).toEqual([saturdayIso, saturdayIso])

  const s = await session(page)
  const dishCount = (day: any) =>
    Object.values(day ?? {}).reduce((n: number, slot: any) => n + (slot?.dishes?.length ?? 0), 0)
  for (const week of [current, nextWeek]) {
    const res = await page.request.get(`${API_URL}/menu/${s.userId}/${week}`, { headers: s.auth })
    expect(res.ok(), `menu for ${week}`).toBe(true)
    const menu = await res.json()
    const counts = (menu.days as unknown[]).map(dishCount)
    if (week === current) {
      // PRO-244: Monday to Friday already went by — nothing generated, not «sin cocinar».
      expect(counts.slice(0, 5)).toEqual([0, 0, 0, 0, 0])
      expect(counts[5] + counts[6]).toBeGreaterThan(0)
      expect(menu.skippedDays ?? []).toEqual([])
    } else {
      expect(counts.filter((n) => n > 0).length).toBeGreaterThan(4)
    }
  }
})
