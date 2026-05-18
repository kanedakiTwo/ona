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
  // Pull a recipe id directly from the API instead of the catalog grid —
  // the catalog page also has a "+ Nueva receta" button whose href starts
  // with "/recipes/" and would shadow the real cards in a generic
  // selector. Fetching via the API gives us an unambiguous target.
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const resp = await page.request.get(`${apiUrl}/recipes?perPage=1`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const list = (await resp.json()) as Array<{ id: string }>
  if (!list || list.length === 0) {
    test.skip(true, 'Empty catalog — seed step did not produce recipes')
    return
  }
  await page.goto(`/recipes/${list[0].id}`)

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
