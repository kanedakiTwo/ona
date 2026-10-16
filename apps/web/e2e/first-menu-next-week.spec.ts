/**
 * PRO-65: signing up on a Sunday used to give a first menu for the week that
 * ends that same day. An onboarding finished Friday to Sunday (Madrid time)
 * now generates the current week and the next, and /menu opens the next.
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
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/menu/generate')) {
      generated.push(JSON.parse(req.postData() ?? '{}').weekStart)
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
  await page.getByPlaceholder('Plato 1').fill('Lentejas')
  await next.click()
  await page.getByRole('button', { name: /salud/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()

  await expect(page).toHaveURL(new RegExp(`/menu\\?week=${nextWeek}`), { timeout: 60_000 })
  expect(generated).toEqual([current, nextWeek])
  await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/tu semana está/i)).toHaveCount(0)

  const s = await session(page)
  for (const week of [current, nextWeek]) {
    const res = await page.request.get(`${API_URL}/menu/${s.userId}/${week}`, { headers: s.auth })
    expect(res.ok(), `menu for ${week}`).toBe(true)
  }
})
