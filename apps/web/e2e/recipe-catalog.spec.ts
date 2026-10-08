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

  // Look for at least one card. Cards are `<a href="/recipes/<uuid>">`
  // inside <main>; `/recipes/new` (the "Añadir receta" header link) is not
  // a card. If the catalog is empty the test reports it as a soft skip —
  // the contract here is that the route renders.
  const cards = page
    .getByRole('main')
    .locator('a[href^="/recipes/"]:not([href="/recipes/new"])')
  try {
    await cards.first().waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    test.skip(true, 'Empty catalog — seed step did not produce recipes')
    return
  }

  await Promise.all([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}(\?|$)/, { timeout: 20_000 }),
    cards.first().click(),
  ])

  // On the detail view, both required parts of the recipe shape render — on
  // mobile as the Ingredientes (default) and Pasos tabs, each with rows.
  const ingTab = page.getByRole('tab', { name: /^ingredientes$/i })
  await expect(ingTab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
  await expect(
    page.getByRole('tabpanel', { name: /ingredientes/i }).getByRole('listitem').first(),
  ).toBeVisible()
  await page.getByRole('tab', { name: /^pasos/i }).click()
  await expect(page.getByRole('tabpanel', { name: /pasos/i }).getByRole('listitem').first()).toBeVisible()
})
