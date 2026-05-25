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
  // Open the catalog and pick the first card whose href looks like
  // `/recipes/<uuid>` — explicitly excludes `/recipes/new` (the floating
  // "+" button), which would land us on the create form instead.
  await page.goto('/recipes')
  const card = page
    .locator(
      'a[href*="/recipes/"]:not([href="/recipes/new"]):not([href$="/recipes"])',
    )
    .first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await Promise.all([page.waitForURL(/\/recipes\/[0-9a-f-]{36}/), card.click()])

  // The cook-mode CTA section carries the new "Cocinada" button.
  await expect(page.getByRole('link', { name: /empezar a cocinar/i })).toBeVisible({
    timeout: 10_000,
  })
  // The CookedBadge returns null while its query is loading, so the
  // button may take a beat to appear after the rest of the page renders.
  // Give it explicit time.
  const cookedBtn = page.getByRole('button', { name: /^cocinada/i }).first()
  await expect(cookedBtn).toBeVisible({ timeout: 10_000 })

  // Initial state — never cooked: label is just "Cocinada" (no count).
  await expect(cookedBtn).toHaveText(/^cocinada$/i)

  // Click it. The button text should switch to "Cocinada 1×".
  await cookedBtn.click()
  await expect(page.getByRole('button', { name: /cocinada 1×/i }).first()).toBeVisible({
    timeout: 10_000,
  })
})
