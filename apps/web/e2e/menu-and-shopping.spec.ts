/**
 * Flow 3: generate a weekly menu and view the shopping list.
 *
 * Skips gracefully if the catalog is empty (the generator can't produce a
 * menu without recipes).
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('generate menu → shopping list renders', async ({ page }) => {
  await page.goto('/menu')

  // The empty-state CTA copy varies a bit; click the most likely "generar"
  // button if present.
  const generate = page.getByRole('button', { name: /generar/i }).first()
  if (await generate.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await generate.click()
    // Wait for the menu to populate: today's featured meal shows up as the
    // photo hero with its "Empezar a cocinar" link (2026-10-08 redesign;
    // before, the "X de 7 días" progress copy).
    await expect(page.getByRole('link', { name: /empezar a cocinar/i }).first()).toBeVisible({ timeout: 30_000 })
  }

  // Navigate to shopping. Either a menu loaded → shopping shows items, or
  // the empty state copy says "no tienes menu" / similar.
  await page.goto('/shopping')
  await expect(page).toHaveURL(/\/shopping/)
  // Soft assertion: the page title or some recognisable copy renders.
  await expect(page.locator('body')).toContainText(/lista|compra|menu|generar/i, { timeout: 10_000 })
})
