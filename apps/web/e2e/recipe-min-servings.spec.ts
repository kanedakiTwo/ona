/**
 * "Siempre la cocino para al menos N" (recipe_notes.min_servings): set it on
 * the recipe detail, it survives a reload, and the scaler starts there.
 * The shopping-list effect is unit-tested (sumDinersByRecipe).
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test('mark a recipe as "always cook at least N"', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  await completeOnboarding(page)

  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const list = await page.request.get(`${apiUrl}/recipes?perPage=1`)
  const [recipe] = await list.json()
  await page.goto(`/recipes/${recipe.id}`)

  // "Tus notas" (and its Raciones mínimas) live in the detail's Notas tab.
  await page.getByRole('tab', { name: /^notas$/i }).click()
  await page.getByRole('button', { name: /siempre la cocino para más gente/i }).click()
  await expect(page.getByTestId('min-servings-value')).toHaveText('4')
  await page.getByRole('button', { name: 'Una ración más' }).click()
  await page.getByRole('button', { name: 'Una ración más' }).click()
  await expect(page.getByTestId('min-servings-value')).toHaveText('6')

  await page.reload()
  // The open tab survives the reload (#notas in the URL).
  await expect(page.getByRole('tab', { name: /^notas$/i })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
  await expect(page.getByTestId('min-servings-value')).toHaveText('6', { timeout: 15_000 })
  await expect(page.getByText(/compra para 6 cada vez/i)).toBeVisible()
  // …and the servings stepper (Ingredientes tab) starts there, not at the
  // household's 1 diner.
  await page.getByRole('tab', { name: /^ingredientes$/i }).click()
  await expect(page.getByTestId('servings-value')).toHaveText('6 raciones')
  await page.getByRole('tab', { name: /^notas$/i }).click()

  await page.getByRole('button', { name: 'Quitar' }).last().click()
  await expect(page.getByRole('button', { name: /siempre la cocino para más gente/i })).toBeVisible()
})
