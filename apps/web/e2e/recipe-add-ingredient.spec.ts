/**
 * PRO-1125, PRO-1115 — a household adds an ingredient the catalogue doesn't
 * have, without «mapping» it: on /recipes/new (mobile) it writes the line,
 * sees «nuevo, se crea al guardar» and saves the recipe. No modal and no
 * USDA list; the ingredient is created with its name when saving, like in
 * the imports (USDA, BEDCA or without nutrition).
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

test('an ingredient that does not exist: «nuevo», then save the recipe without any modal', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }

  // One unique word: a name sharing words with the library would ask «¿cuál?».
  const name = `wakame${Date.now().toString(36)}`
  await page.goto('/recipes/new')
  await page.locator('input[placeholder*="Tortilla" i]').fill('Ensalada de kombu de prueba')
  await page.locator('input[placeholder="30"]').fill('10')
  await page.getByRole('button', { name: /comida/i }).first().click()
  await page.getByRole('button', { name: /primavera/i }).first().click()

  await page.locator('#recipe-ingredients').fill(`20 g de ${name}`)
  const line = page.getByTestId('ingredient-line').first()
  await expect(line).toHaveAttribute('data-status', 'new', { timeout: 10_000 })
  await expect(line).toContainText('nuevo, se crea al guardar')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('#recipe-steps').fill(`Corta el ${name} en tiras finas.`)

  await Promise.all([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/edit/, { timeout: 40_000 }),
    page.getByRole('button', { name: /^crear receta$/i }).click(),
  ])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const recipeId = page.url().match(/\/recipes\/([0-9a-f-]{36})\/edit/)![1]

  // The row exists with its own name, and the recipe uses it.
  const found: Array<{ id: string; name: string }> = await (
    await page.request.get(`${API_URL}/ingredients?search=${encodeURIComponent(name)}`)
  ).json()
  expect(found).toEqual([expect.objectContaining({ name })])
  const recipe = await (await page.request.get(`${API_URL}/recipes/${recipeId}`, { headers: auth })).json()
  expect(recipe.ingredients).toEqual([expect.objectContaining({ ingredientId: found[0].id, quantity: 20, unit: 'g' })])
})
