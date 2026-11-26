/**
 * Flow: create a new recipe end-to-end through /recipes/new.
 *
 * This spec exists because in May 2026 the "Crear receta" button shipped
 * silently broken (missing `servings` + wrong `steps` shape vs the server
 * schema) and the form swallowed the validation errors. No test caught
 * it. This spec covers the happy path so the same class of bug fails CI
 * on the next push.
 *
 * The seed has «ajo»; the ingredients go one per line (PRO-1115).
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('happy path: fill the form, click Crear, land on the new recipe', async ({ page }) => {
  await page.goto('/recipes/new')
  await expect(page).toHaveURL(/\/recipes\/new/)

  // Name
  await page.locator('input[placeholder*="Tortilla" i]').fill('E2E receta de prueba')

  // Servings — defaults to 2; leave as-is to also verify the default path.

  // Prep time
  await page.locator('input[placeholder="30"]').fill('20')

  // Meals: pick "Comida" (lunch) — there are buttons with the meal labels.
  await page.getByRole('button', { name: /comida/i }).first().click()

  // Seasons: pick "Primavera"
  await page.getByRole('button', { name: /primavera/i }).first().click()

  // Ingredients, one per line (PRO-1115): «✓» once the library knows it.
  await page.locator('#recipe-ingredients').fill('10 g de ajo')
  await expect(page.getByTestId('ingredient-line').first()).toHaveAttribute('data-status', 'match', { timeout: 10_000 })

  // Step
  await page.locator('#recipe-steps').fill('Pelar y picar el ajo')

  // Submit
  const submit = page.getByRole('button', { name: /^crear receta$/i })
  await expect(submit).toBeEnabled()

  // Since 2026-05-30 a successful create lands on the edit screen
  // (`/recipes/<id>/edit`) so the author can fine-tune straight away.
  await Promise.all([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/edit/, { timeout: 20_000 }),
    submit.click(),
  ])

  // The edit form loads the persisted recipe from the API: its name input
  // (first text input of the form, under "Capitulo 01 · Nombre") must carry
  // what we typed — proof the row was actually written.
  await expect(page.getByRole('main').locator('form input[type="text"]').first()).toHaveValue(
    'E2E receta de prueba',
    { timeout: 10_000 },
  )
})

test('validation: empty form surfaces specific field errors instead of silent failure', async ({ page }) => {
  await page.goto('/recipes/new')

  const submit = page.getByRole('button', { name: /^crear receta$/i })
  // Button must be clickable even with an incomplete form — silent disabled
  // buttons are the bug class this spec defends against.
  await expect(submit).toBeEnabled()
  await submit.click()

  // The form should render an error banner listing missing fields.
  const main = page.getByRole('main')
  await expect(main.getByText(/faltan datos/i)).toBeVisible({ timeout: 5_000 })
  // At minimum, the name field should be flagged since it's empty. Errors
  // render as `<li>` items prefixed with the humanized field label.
  await expect(main.getByRole('listitem').filter({ hasText: /^Nombre:/ })).toBeVisible()
})
