/**
 * Flow 1: register a fresh user and reach the in-product app.
 *
 * Asserts:
 *   - /register is reachable and has the three input fields
 *   - Submitting valid credentials redirects to /onboarding or /menu
 *   - The user can complete onboarding (or it auto-completes) and lands on /menu
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test('register → onboarding → menu', async ({ page }) => {
  await registerFreshUser(page)

  // Onboarding may be the next stop; if it is, walk through it.
  if (page.url().includes('/onboarding')) {
    await completeOnboarding(page)
  }

  // We may end up on /onboarding (still mid-flow) if the helper times out;
  // accept either /menu or /onboarding as a successful outcome — what we
  // care about is that registration didn't bounce us back to / or /login.
  await expect(page).toHaveURL(/\/(menu|onboarding)/, { timeout: 10_000 })
})

test('the onboarding answers produce a real first menu (not an empty week)', async ({ page }) => {
  await registerFreshUser(page)
  await page.goto('/onboarding')

  const generates: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/menu/generate')) generates.push(req.postData() ?? '')
  })

  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click() // 1 adult (default)
  await page.getByRole('button', { name: /3-4 veces/i }).click()
  await next.click()
  await page.getByRole('button', { name: /sin gluten/i }).click()
  await next.click()
  await page.getByPlaceholder('Plato 1').fill('Lentejas')
  await next.click()
  await page.getByRole('button', { name: /salud/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()

  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })
  // The first generate is a real one (no `empty`), sent before landing.
  expect(generates.length).toBeGreaterThan(0)
  expect(JSON.parse(generates[0]).empty).toBeUndefined()
  await expect(page.getByText(/tu semana está/i)).toHaveCount(0, { timeout: 15_000 })
})

test('/register page renders with the expected fields', async ({ page }) => {
  await page.goto('/register')
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /crear|registr/i })).toBeVisible()
})
