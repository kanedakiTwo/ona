/**
 * «Hogar fundador» (specs/household.md, 2026-10-15): every household created
 * before launch day shows the badge on the profile header and on Casa; and a
 * brand-new account never gets the beta price survey (it waits a week).
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test('a beta household is «Hogar fundador» on the profile and on Casa; no price survey on day one', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const survey = page.waitForResponse((r) => r.url().endsWith('/price-survey') && r.request().method() === 'GET')
  await page.goto('/menu')
  expect((await survey).ok()).toBe(true)
  // The sheet would open 1.5 s after the menu paints; a day-one account never gets it.
  await page.waitForTimeout(2_500)
  await expect(page.getByTestId('price-survey')).toHaveCount(0)

  await page.goto('/profile')
  await expect(page.getByTestId('founding-badge')).toHaveText(/Hogar fundador/i, { timeout: 10_000 })
  await page.goto('/profile/casa')
  await expect(page.getByTestId('founding-badge')).toBeVisible({ timeout: 10_000 })
})
