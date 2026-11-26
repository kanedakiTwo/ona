/**
 * 2026-11-02: an imported recipe came in without ingredients, and changing
 * its title in /recipes/[id]/edit did nothing — «Guardar cambios» was greyed
 * out with no word about why. The edit form now says what's missing next to
 * the button. Same create flow as recipe-ingredient-note.spec.ts.
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test('the edit form says why it cannot save, and saves once fixed', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.goto('/recipes/new')
  await page.locator('input[placeholder*="Tortilla" i]').fill('E2E receta por guardar')
  await page.locator('input[placeholder="30"]').fill('20')
  await page.getByRole('button', { name: /comida/i }).first().click()
  await page.getByRole('button', { name: /primavera/i }).first().click()

  await page.locator('#recipe-ingredients').fill('10 g de ajo')
  await expect(page.getByTestId('ingredient-line').first()).toHaveAttribute('data-status', 'match', { timeout: 10_000 })
  await page.locator('#recipe-steps').fill('Pelar y picar el ajo')

  await Promise.all([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/edit/, { timeout: 20_000 }),
    page.getByRole('button', { name: /^crear receta$/i }).click(),
  ])

  // Open the editor with a full load, like coming back to a saved recipe.
  // Right after a client-side navigation PageTransition mounts the new page
  // twice (once inside the fading-out wrapper, ~250 ms), and whatever is
  // typed into the first copy is lost.
  const id = page.url().match(/recipes\/([0-9a-f-]{36})/)![1]
  await page.goto(`/recipes/${id}/edit`)

  const save = page.getByRole('button', { name: /^guardar cambios$/i })
  const title = page.locator('#recipe-name')
  const ingredients = page.locator('#recipe-ingredients')
  await expect(save).toBeEnabled({ timeout: 15_000 })
  await expect(ingredients).toHaveValue('10 g de ajo')

  // No ingredient → disabled, and it says why.
  await ingredients.fill('')
  await expect(save).toBeDisabled()
  await expect(page.getByTestId('save-hint')).toContainText(/añade al menos un ingrediente/i)

  // No title → the hint names the title instead.
  await ingredients.fill('10 g de ajo')
  await title.fill('')
  await expect(page.getByTestId('save-hint')).toContainText(/ponle un nombre/i)

  // Fixed → no hint, and the new title is saved.
  await title.fill('E2E receta con título nuevo')
  await expect(page.getByTestId('save-hint')).toHaveCount(0)
  await expect(save).toBeEnabled()
  await Promise.all([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}$/, { timeout: 20_000 }),
    save.click(),
  ])
  await expect(page.getByRole('heading', { name: /título nuevo/i }).first()).toBeVisible({ timeout: 15_000 })
})
