/**
 * Flow 4: edit profile → save → success indicator.
 *
 * This spec is a regression for the bug we fixed where the profile save was
 * sending snake_case + putting all blob data into the wrong endpoint. The
 * "✓ Guardado" badge appears for ~2.5s after a 200 response from both the
 * /user/:id and /user/:id/settings calls.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('profile save shows the success indicator', async ({ page }) => {
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/profile/)

  // Touch at least one field so the payload isn't empty (otherwise the
  // user PUT skips, which is a valid path but doesn't exercise the bug).
  // Find the first numeric input and set a value.
  const numInput = page.locator('input[inputmode="numeric"], input[type="number"]').first()
  if (await numInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await numInput.fill('30')
  }

  const save = page.getByRole('button', { name: /guardar/i })
  await expect(save).toBeVisible()
  await save.click()

  // The save success state shows a check-mark badge with "Guardado" copy.
  await expect(page.getByText(/guardado/i).first()).toBeVisible({ timeout: 10_000 })
})
