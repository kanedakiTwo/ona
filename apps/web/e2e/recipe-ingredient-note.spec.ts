/**
 * PRO-109: each ingredient of /recipes/new and /recipes/[id]/edit has an
 * optional note («en lomos», «picada»): since PRO-1115, what follows the
 * comma in its line. It is saved and shown on the recipe detail next to the
 * ingredient. Same flow as recipe-create.spec.ts.
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test('write a note on an ingredient, save, see it on the detail and in the edit form', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.goto('/recipes/new')
  await page.locator('input[placeholder*="Tortilla" i]').fill('E2E receta con nota')
  await page.locator('input[placeholder="30"]').fill('20')
  await page.getByRole('button', { name: /comida/i }).first().click()
  await page.getByRole('button', { name: /primavera/i }).first().click()

  // The note goes after the comma (PRO-1115) and shows under the line.
  await page.locator('#recipe-ingredients').fill('10 g de ajo, picado fino')
  const line = page.getByTestId('ingredient-line').first()
  await expect(line).toHaveAttribute('data-status', 'match', { timeout: 10_000 })
  await expect(line).toContainText('picado fino')
  await page.locator('#recipe-steps').fill('Pelar y picar el ajo')

  await Promise.all([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/edit/, { timeout: 20_000 }),
    page.getByRole('button', { name: /^crear receta$/i }).click(),
  ])

  // The edit form loads it back from the API, as the same line.
  await expect(page.locator('#recipe-ingredients')).toHaveValue('10 g de ajo, picado fino', { timeout: 10_000 })

  // And the detail shows it.
  const id = page.url().match(/recipes\/([0-9a-f-]{36})/)![1]
  await page.goto(`/recipes/${id}`)
  await expect(page.getByText('picado fino')).toBeVisible({ timeout: 15_000 })
})
