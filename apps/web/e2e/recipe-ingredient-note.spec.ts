/**
 * PRO-109: each ingredient row of /recipes/new and /recipes/[id]/edit has an
 * optional «Nota» («en lomos», «picada»). It is saved and shown on the recipe
 * detail next to the ingredient. Same flow as recipe-create.spec.ts.
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

  await page.getByPlaceholder(/ingrediente|cargando/i).first().fill('ajo')
  const ajoOption = page.locator('ul[role="listbox"] li button', { hasText: /^ajo$/i }).first()
  try {
    await ajoOption.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    test.skip(true, 'Catalog has no exact "ajo" match — seed missing or renamed.')
    return
  }
  await ajoOption.click()
  await page.locator('input[placeholder="Cant."]').first().fill('10')
  await page.getByRole('textbox', { name: /nota de ajo/i }).fill('picado fino')
  await page.locator('textarea').first().fill('Pelar y picar el ajo')

  await Promise.all([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/edit/, { timeout: 20_000 }),
    page.getByRole('button', { name: /^crear receta$/i }).click(),
  ])

  // The edit form loads it back from the API.
  await expect(page.getByRole('textbox', { name: /nota de ajo/i })).toHaveValue('picado fino', { timeout: 10_000 })

  // And the detail shows it.
  const id = page.url().match(/recipes\/([0-9a-f-]{36})/)![1]
  await page.goto(`/recipes/${id}`)
  await expect(page.getByText('picado fino')).toBeVisible({ timeout: 15_000 })
})
