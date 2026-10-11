/**
 * PRO-33 — «Hoy», «Mañana» and «Esta semana» on /shopping: one tap narrows
 * the list to today's dishes (or tomorrow's) and «Esta semana» brings back
 * the default range. Mobile, 390×844.
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user'))) ?? '{}')
  return { headers: { Authorization: `Bearer ${token}` }, userId: user.id as string }
}

/** Dates as the browser sees them (the page computes "today" client-side). */
async function browserDates(page: Page) {
  return page.evaluate(() => {
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const defaultTo = new Date(monday)
    defaultTo.setDate(monday.getDate() + 13)
    return { today: iso(now), weekStart: iso(monday), defaultTo: iso(defaultTo) }
  })
}

async function listCount(page: Page, headers: Record<string, string>, from: string, to: string) {
  const res = await page.request.get(`${apiUrl}/shopping-list?from=${from}&to=${to}`, { headers })
  expect(res.ok(), `shopping-list ${res.status()}`).toBeTruthy()
  const body = await res.json()
  return (body.items ?? []).length as number
}

test('/shopping: «Hoy» shows only today, «Esta semana» restores the default range', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const { headers, userId } = await auth(page)
  const { today, weekStart, defaultTo } = await browserDates(page)
  const gen = await page.request.post(`${apiUrl}/menu/generate`, { headers, data: { userId, weekStart } })
  expect(gen.ok(), `menu/generate ${gen.status()}`).toBeTruthy()

  // What the API builds for today alone vs. the default range. Both with
  // explicit dates, as the page sends them: the API's own default uses
  // Madrid's date, which can be a day ahead of the browser's (CI runs in UTC).
  const todayCount = await listCount(page, headers, today, today)
  const defaultCount = await listCount(page, headers, today, defaultTo)
  expect(todayCount).toBeLessThanOrEqual(defaultCount)

  await page.goto('/shopping')
  const range = page.getByTestId('shopping-range')
  await expect(range).toBeVisible({ timeout: 15_000 })
  const defaultLabel = (await range.textContent()) ?? ''
  const total = page.getByTestId('shopping-total')
  await expect(total).toHaveText(String(defaultCount), { timeout: 15_000 })

  const hoy = page.getByRole('button', { name: 'Hoy', exact: true })
  const manana = page.getByRole('button', { name: 'Mañana', exact: true })
  const semana = page.getByRole('button', { name: 'Esta semana', exact: true })
  // The default range is «Esta semana».
  await expect(semana).toHaveAttribute('aria-pressed', 'true')
  await expect(hoy).toHaveAttribute('aria-pressed', 'false')

  // «Hoy»: a one-day range and only today's dishes.
  await hoy.click()
  await expect(hoy).toHaveAttribute('aria-pressed', 'true')
  await expect(semana).toHaveAttribute('aria-pressed', 'false')
  const day = Number(today.split('-')[2])
  await expect(range).toHaveText(new RegExp(`^${day} [a-z]{3}$`))
  await expect(total).toHaveText(String(todayCount), { timeout: 15_000 })

  // «Mañana» marks itself.
  await manana.click()
  await expect(manana).toHaveAttribute('aria-pressed', 'true')
  await expect(hoy).toHaveAttribute('aria-pressed', 'false')

  // «Esta semana»: back to the default range and list.
  await semana.click()
  await expect(semana).toHaveAttribute('aria-pressed', 'true')
  await expect(range).toHaveText(defaultLabel)
  await expect(total).toHaveText(String(defaultCount), { timeout: 15_000 })

  // The arrows still move the range; no shortcut matches it then.
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  await expect(range).not.toHaveText(defaultLabel)
  await expect(page.locator('[aria-pressed="true"]').filter({ hasText: /^(Hoy|Mañana|Esta semana)$/ })).toHaveCount(0)
})
