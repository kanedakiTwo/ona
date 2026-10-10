/**
 * Week arrows (Miguel, 2026-10-10): on /menu and /shopping the week changes
 * with ‹ › in the header, on mobile and desktop, without opening "···".
 * Plus the /shopping progress regression of the same day: a row bought and
 * then marked "en casa" counts once (it showed "72/56 · 129 % listo").
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

async function generateThisWeek(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user'))) ?? '{}')
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const weekStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const res = await page.request.post(`${apiUrl}/menu/generate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { userId: user.id, weekStart },
  })
  expect(res.ok(), `menu/generate ${res.status()}`).toBeTruthy()
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await generateThisWeek(page)
})

test('/menu: ‹ › change the week from the header', async ({ page }) => {
  await page.goto('/menu')
  const range = page.getByTestId('menu-week-range').first()
  await expect(range).toBeVisible({ timeout: 15_000 })
  // textContent, not innerText: the eyebrow is uppercased with CSS.
  const thisWeek = (await range.textContent()) ?? ''

  await page.getByRole('button', { name: 'Semana siguiente' }).first().click()
  await expect(range).not.toHaveText(thisWeek)
  await expect(page.getByRole('button', { name: /volver a hoy/i })).toBeVisible()

  await page.getByRole('button', { name: 'Semana anterior' }).first().click()
  await expect(range).toHaveText(thisWeek)
})

test('/shopping: ‹ › move the dates a week; progress counts each row once', async ({ page }) => {
  await page.goto('/shopping')
  const range = page.getByTestId('shopping-range')
  await expect(range).toBeVisible({ timeout: 15_000 })
  const thisWeek = (await range.textContent()) ?? ''

  // The range starts today: nothing before it.
  await expect(page.getByRole('button', { name: 'Semana anterior' })).toBeDisabled()
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  await expect(range).not.toHaveText(thisWeek)
  await page.getByRole('button', { name: 'Semana anterior' }).click()
  await expect(range).toHaveText(thisWeek)

  // Bought, then "en casa": still one row done, not two. Back on a range
  // already seen, the rows wait (disabled) for the rebuilt list before writing.
  const done = page.getByTestId('shopping-done')
  await expect(done).toHaveText('0')
  await page.getByRole('button', { name: 'Marcar como comprado' }).first().click()
  await expect(done).toHaveText('1')
  await page.getByRole('button', { name: 'Marcar en casa' }).first().click()
  await expect(done).toHaveText('1')

  // What was marked survives a look at another week (item_state, 2026-10-10:
  // the next week has other products and the "en casa" used to be lost).
  const atHome = page.getByTestId('shopping-athome')
  await expect(atHome).toHaveText('1')
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  await expect(range).not.toHaveText(thisWeek)
  await page.getByRole('button', { name: 'Semana anterior' }).click()
  await expect(range).toHaveText(thisWeek)
  await expect(atHome).toHaveText('1', { timeout: 10_000 })
})
