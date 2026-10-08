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
  // Open the catalog and pick the first recipe card. Scoped to <main> (the
  // desktop sidebar is in the DOM but hidden on mobile) and excluding
  // `/recipes/new` (the "Nueva receta" button in the header).
  await page.goto('/recipes')
  const card = page
    .getByRole('main')
    .locator('a[href^="/recipes/"]:not([href="/recipes/new"])')
    .first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await Promise.all([page.waitForURL(/\/recipes\/[0-9a-f-]{36}(\?|$)/), card.click()])

  // The detail page has two "Empezar a cocinar" links (inline in the
  // Preparación header + the bottom "Modo cocina" CTA). The "Cocinada"
  // button lives in the Modo cocina section, so scope everything to it.
  const cookSection = page.locator('section').filter({ hasText: 'Modo cocina' })
  await expect(cookSection.getByRole('link', { name: /^empezar a cocinar$/i })).toBeVisible({
    timeout: 10_000,
  })

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
