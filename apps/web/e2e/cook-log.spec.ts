/**
 * Flow: record a cook from the recipe detail page → see the count update.
 *
 * The "Cocinada" CTA next to "Empezar a cocinar" POSTs to /cook-logs and
 * invalidates the per-recipe stats query, so the same button re-renders as
 * "Cocinada 1×". This spec is the regression for PR 6 — without the new
 * cook-log surface, the button wouldn't exist at all.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('recipe detail: marking cooked increments the count', async ({ page }) => {
  // Open the catalog, click the first recipe card.
  await page.goto('/recipes')
  const firstCard = page.locator('a[href*="/recipes/"]').first()
  await expect(firstCard).toBeVisible({ timeout: 10_000 })
  await firstCard.click()

  // The cook-mode CTA section carries the new "Cocinada" button.
  await expect(page.getByRole('link', { name: /empezar a cocinar/i })).toBeVisible({
    timeout: 10_000,
  })
  const cookedBtn = page.getByRole('button', { name: /^cocinada/i }).first()
  await expect(cookedBtn).toBeVisible()

  // Initial state — never cooked: label is just "Cocinada" (no count).
  await expect(cookedBtn).toHaveText(/^cocinada$/i)

  // Click it. The button text should switch to "Cocinada 1×".
  await cookedBtn.click()
  await expect(page.getByRole('button', { name: /cocinada 1×/i }).first()).toBeVisible({
    timeout: 8_000,
  })
})
