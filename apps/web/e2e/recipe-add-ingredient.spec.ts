/**
 * PRO-1125 — a household adds an ingredient the catalogue doesn't have,
 * without «mapping» it: on /recipes/new (mobile) it types the name, taps
 * «Añadir» and saves the recipe. No modal and no USDA list; the ingredient is
 * created with its name and the recipe saves with «nutrición incompleta»
 * until Cocina fills the values.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

test('an ingredient that does not exist: «Añadir», then save the recipe without any modal', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }

  const name = `kombu ahumado ${Date.now().toString(36)}`
  await page.goto('/recipes/new')
  await page.locator('input[placeholder*="Tortilla" i]').fill('Ensalada de kombu de prueba')
  await page.locator('input[placeholder="30"]').fill('10')
  await page.getByRole('button', { name: /comida/i }).first().click()
  await page.getByRole('button', { name: /primavera/i }).first().click()

  await page.getByPlaceholder(/ingrediente|cargando/i).first().fill(name)
  const add = page.getByRole('listbox').getByRole('button', { name: new RegExp(`^Añadir.*${name}`) })
  await expect(add).toBeVisible({ timeout: 10_000 })
  await add.click()

  // Picked straight away: no dialog, the row carries the new ingredient.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(page.getByPlaceholder(/ingrediente|cargando/i).first()).toHaveValue(name)

  await page.locator('input[placeholder="Cant."]').first().fill('20')
  await page.locator('textarea').first().fill(`Corta el ${name} en tiras finas.`)

  await Promise.all([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/edit/, { timeout: 20_000 }),
    page.getByRole('button', { name: /^crear receta$/i }).click(),
  ])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const recipeId = page.url().match(/\/recipes\/([0-9a-f-]{36})\/edit/)![1]

  // The row exists with its own name, and the recipe is «incompleta» until Cocina fills it.
  const found: Array<{ id: string; name: string; fdcId: number | null; calories: number }> = await (
    await page.request.get(`${API_URL}/ingredients?search=${encodeURIComponent(name)}`)
  ).json()
  expect(found).toEqual([expect.objectContaining({ name, fdcId: null, calories: 0 })])
  const recipe = await (await page.request.get(`${API_URL}/recipes/${recipeId}`, { headers: auth })).json()
  expect(recipe.nutritionIncomplete).toBe(true)
})
