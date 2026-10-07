/**
 * Flow: create a new recipe end-to-end through /recipes/new.
 *
 * This spec exists because in May 2026 the "Crear receta" button shipped
 * silently broken (missing `servings` + wrong `steps` shape vs the server
 * schema) and the form swallowed the validation errors. No test caught
 * it. This spec covers the happy path so the same class of bug fails CI
 * on the next push.
 *
 * If the test DB has no ingredients seeded, the test soft-skips after
 * asserting the page rendered — the contract is "form is usable", not
 * "seed is correct" (that's another spec's job).
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

  // Ingredient: type into the autocomplete and pick the option that
  // matches what we typed. We have to wait for the debounced search
  // (200ms) to refresh the dropdown — clicking the literal first <li>
  // would pick whatever the empty-query fetch returned first (e.g.
  // "aceite de oliva virgen" alphabetically), which causes the server's
  // lint to fire ORPHAN_INGREDIENT + STEP_INGREDIENT_NOT_LISTED later.
  const ingredientInput = page.getByPlaceholder(/ingrediente|cargando/i).first()
  await ingredientInput.fill('ajo')
  const ajoOption = page
    .locator('ul[role="listbox"] li button', { hasText: /^ajo$/i })
    .first()
  try {
    await ajoOption.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    test.skip(true, 'Catalog has no exact "ajo" match — seed missing or renamed.')
    return
  }
  await ajoOption.click()

  // Quantity for that ingredient
  await page.locator('input[placeholder="Cant."]').first().fill('10')

  // Step
  await page.locator('textarea').first().fill('Pelar y picar el ajo')

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
