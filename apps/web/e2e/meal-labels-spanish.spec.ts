/**
 * PRO-116: «Añadir comida» offered «Snack», in English. The meal is
 * «Merienda» everywhere (menu, its sheets, catalogue chips). Fails if
 * «Snack» is seen. Mobile 390×844.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

test('«Añadir comida» says «Merienda», never «Snack»', async ({ page }) => {
  test.setTimeout(120_000)
  const { weekStart, dayIdx } = await pinClock(page)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await gen.json()
  // Today without merienda, so the sheet offers it.
  if (menu.days[dayIdx]?.snack) {
    const del = await page.request.delete(`${API}/menu/${menu.id}/day/${dayIdx}/meal/snack`, { headers })
    expect(del.ok()).toBeTruthy()
  }

  await page.goto('/menu')
  const add = page.getByRole('button', { name: /^añadir comida$/i })
  await expect(add).toBeVisible({ timeout: 20_000 })
  await add.click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: /^merienda$/i })).toBeVisible()
  await expect(page.getByText(/snack/i)).toHaveCount(0)

  // The meal once added keeps the Spanish name.
  await sheet.getByRole('button', { name: /^merienda$/i }).click()
  await expect(page.getByText(/merienda/i).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/snack/i)).toHaveCount(0)
})
