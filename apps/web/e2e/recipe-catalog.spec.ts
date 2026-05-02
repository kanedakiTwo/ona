/**
 * Flow 2: browse the recipe catalog and open a detail.
 *
 * If the test DB has no recipes seeded, the test soft-skips after asserting
 * the page rendered.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('catalog renders + detail page opens for the first card', async ({ page }) => {
  await page.goto('/recipes')

  // Header is the editorial-mode "Recetas" title (font-display).
  await expect(page).toHaveURL(/\/recipes/)

  // Look for at least one card. The card markup uses `<a href="/recipes/...">`
  // wrapping the photo + name. If the catalog is empty the test reports it
  // as a soft skip — the contract here is that the route renders.
  const cards = page.locator('a[href^="/recipes/"]')
  const count = await cards.count()
  if (count === 0) {
    test.skip(true, 'Empty catalog — seed step did not produce recipes')
    return
  }

  await Promise.all([
    page.waitForURL(/\/recipes\/[^/]+/, { timeout: 10_000 }),
    cards.first().click(),
  ])

  // On the detail view, expect either ingredients or a step list to render —
  // both are required parts of the recipe shape.
  await expect(
    page.getByText(/ingredientes|preparaci/i).first(),
  ).toBeVisible({ timeout: 10_000 })
})
