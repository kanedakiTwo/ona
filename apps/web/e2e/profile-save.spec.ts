/**
 * Flow 4: edit your body data → save → success indicator.
 *
 * A regression for the bug where the profile save sent snake_case and put
 * the blob into the wrong endpoint. Since PRO-1203 the body data and the goal
 * live in your row of «Quién come» («Salud y objetivo», with the health-data
 * consent) and save themselves: the "✓ Guardado" badge appears after a 200
 * from both /user/:id and /user/:id/settings.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('saving your body data shows the success indicator and stores it', async ({ page }) => {
  await page.goto('/profile/quien/me')
  const card = page.getByTestId('health-and-goal')
  // Physical data needs the health-data consent first (PRO-21).
  const consent = card.getByRole('checkbox', { name: /datos de salud/i })
  await consent.click() // async: the box follows the server's answer
  await expect(consent).toBeChecked({ timeout: 10_000 })
  await card.getByRole('spinbutton', { name: /edad/i }).fill('30')
  await card.getByRole('button', { name: 'Perder peso' }).click()

  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/user\/[^/]+\/settings$/.test(r.url()))
  await card.getByRole('button', { name: /^guardar$/i }).click()
  expect((await saved).ok()).toBe(true)
  await expect(card.getByText(/guardado/i)).toBeVisible({ timeout: 10_000 })

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!)
  const account = await (await page.request.get(`${API_URL}/user/${user.id}`, { headers: { Authorization: `Bearer ${token}` } })).json()
  expect(account.age).toBe(30)
  expect(account.priority).toBe('healthy')
})
