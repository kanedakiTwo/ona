/**
 * "Para hacer la compra" (specs/recipe-quality.md → Shoppability): a recipe
 * whose ingredients the shopping list / shop orders can't use as written
 * tells its author so on the detail page — and stops once it's fixed.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test('a recipe with "ternera" and no cut shows the shopping check; naming the cut clears it', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  const found = await (await page.request.get(`${API_URL}/ingredients?search=ternera&perPage=50`)).json()
  const ternera = (found as Array<{ id: string; name: string }>).find((i) => i.name === 'ternera')
  expect(ternera, 'seed has "ternera"').toBeTruthy()

  const body = {
    name: 'Ternera guisada de prueba',
    servings: 2,
    meals: ['lunch'],
    seasons: ['winter'],
    equipment: ['cazuela'],
    ingredients: [{ ingredientId: ternera!.id, quantity: 400, unit: 'g' }],
    steps: [{ index: 0, text: 'Guisa la ternera a fuego lento.' }],
    force: true,
  }
  const created = await page.request.post(`${API_URL}/recipes`, { headers: auth, data: body })
  expect(created.status()).toBe(201)
  const recipe = await created.json()
  expect(recipe.warnings.map((w: { code: string }) => w.code)).toContain('BUY_NEEDS_CHOICE')

  await page.goto(`/recipes/${recipe.id}`)
  const card = page.getByTestId('shopping-issues')
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card).toContainText('¿Para qué es la ternera?')

  // Name the cut in the note → nothing left to fix.
  const fixed = await page.request.put(`${API_URL}/recipes/${recipe.id}`, {
    headers: auth,
    data: { ...body, ingredients: [{ ...body.ingredients[0], note: 'para guisar' }] },
  })
  expect(fixed.ok()).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Ternera guisada de prueba/ })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('shopping-issues')).toHaveCount(0)
})
