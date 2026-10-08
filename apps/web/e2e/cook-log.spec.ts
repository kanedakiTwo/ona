/**
 * Flow: record a cook from the recipe detail page → see the count update.
 *
 * The "Cocinada" CTA (Notas tab of the detail since the 2026-10-08 redesign)
 * POSTs to /cook-logs and invalidates the per-recipe stats query, so the same
 * button re-renders as "Cocinada 1×". This spec is the regression for PR 6 —
 * without the cook-log surface, the button wouldn't exist at all.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('recipe detail: marking cooked increments the count', async ({ page }) => {
  // Open the catalog and pick the first recipe card. Scoped to <main> (the
  // desktop sidebar is in the DOM but hidden on mobile) and excluding
  // `/recipes/new` (the "Añadir receta" link in the header).
  await page.goto('/recipes')
  const card = page
    .getByRole('main')
    .locator('a[href^="/recipes/"]:not([href="/recipes/new"])')
    .first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await Promise.all([page.waitForURL(/\/recipes\/[0-9a-f-]{36}(\?|$)/), card.click()])

  // "Empezar a cocinar" lives in the sticky bottom action bar; the
  // "Cocinada" button lives in the Notas tab, so open it and scope to it.
  await expect(
    page.getByTestId('recipe-action-bar').getByRole('link', { name: /^empezar a cocinar$/i }),
  ).toBeVisible({ timeout: 10_000 })
  await page.getByRole('tab', { name: /^notas$/i }).click()
  const cookSection = page.getByRole('tabpanel', { name: /notas/i })

  // The button's accessible name is its aria-label ("Marcar como cocinada");
  // the visible text carries the count.
  const cookedBtn = cookSection.getByRole('button', { name: /marcar como cocinada/i })
  await expect(cookedBtn).toBeVisible({ timeout: 10_000 })

  // Initial state — never cooked: label is just "Cocinada" (no count).
  await expect(cookedBtn).toHaveText(/^cocinada$/i)

  // Click it. The button text should switch to "Cocinada 1×".
  await cookedBtn.click()
  await expect(cookedBtn).toHaveText(/^cocinada 1×$/i, { timeout: 10_000 })
})
