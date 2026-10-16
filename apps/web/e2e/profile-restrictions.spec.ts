/**
 * PRO-64: a restriction picked in onboarding is stored on the account
 * (`users.restrictions`), but /profile used to read only `user_settings`,
 * so "sin gluten" showed unticked and users thought it wasn't saved. The
 * profile now shows the union of both stores, and saving writes it to both
 * without dropping either. Mobile (390×844).
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!)
  return { auth: { Authorization: `Bearer ${token}` }, userId: user.id as string }
}

/** Onboarding with the health-data box ticked and "sin gluten" picked. */
async function onboardWithGlutenFree(page: Page) {
  await page.goto('/onboarding')
  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  await page.getByRole('button', { name: /3-4 veces/i }).click()
  await next.click()
  await page.getByRole('checkbox', { name: /datos de salud/i }).check()
  await page.getByRole('button', { name: /sin gluten/i }).click()
  await next.click()
  await page.getByRole('button', { name: /salud/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
})

test('the profile shows the onboarding restriction and saving keeps it in both places', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await onboardWithGlutenFree(page)

  await page.goto('/profile')
  // Shown as a selected chip (with its «Quitar» button), not as a "+ sin gluten" suggestion.
  await expect(page.getByRole('button', { name: 'Quitar sin gluten' })).toBeVisible({ timeout: 15_000 })

  // Add another one in the profile and save.
  await page.getByRole('button', { name: /^vegetariano$/i }).click()
  await expect(page.getByRole('button', { name: 'Quitar vegetariano' })).toBeVisible()
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText(/guardado/i).first()).toBeVisible({ timeout: 10_000 })

  const s = await session(page)
  const account = await (await page.request.get(`${API_URL}/user/${s.userId}`, { headers: s.auth })).json()
  expect(account.restrictions).toEqual(['sin gluten', 'vegetariano'])
  const settings = await (await page.request.get(`${API_URL}/user/${s.userId}/settings`, { headers: s.auth })).json()
  expect(settings.template.preferences.restrictions).toEqual(['sin gluten', 'vegetariano'])

  // After a reload both are still shown.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Quitar sin gluten' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Quitar vegetariano' })).toBeVisible()
})
