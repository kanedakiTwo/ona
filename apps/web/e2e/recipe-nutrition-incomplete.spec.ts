/**
 * PRO-176 — a recipe whose nutrition can't be calculated (an ingredient by
 * units with no weight per unit) shows no figures on its ficha: no kcal under
 * the title, and the Nutrición tab says «Aún no podemos calcular la nutrición
 * de esta receta». Mobile, 390×844.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

test('recipe detail: incomplete nutrition shows no kcal', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  const found: Array<{ id: string; name: string }> = await (
    await page.request.get(`${API_URL}/ingredients?search=ternera&perPage=50`)
  ).json()
  const ternera = found.find((i) => i.name === 'ternera')
  expect(ternera, 'seed has «ternera» (no weight per unit)').toBeTruthy()

  const created = await page.request.post(`${API_URL}/recipes?force=1`, {
    headers: auth,
    data: {
      name: 'Ternera por piezas de prueba',
      servings: 2,
      meals: ['lunch'],
      seasons: ['winter'],
      ingredients: [{ ingredientId: ternera!.id, quantity: 2, unit: 'u' }],
      steps: [{ index: 0, text: 'Asa la ternera.' }],
    },
  })
  expect(created.status(), await created.text()).toBe(201)
  const recipe = await created.json()
  expect(recipe.nutritionIncomplete).toBe(true)

  await page.goto(`/recipes/${recipe.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ternera por piezas de prueba', { timeout: 15_000 })
  await expect(page.getByText(/kcal/i)).toHaveCount(0)

  const tablist = page.getByRole('tablist', { name: /secciones de la receta/i })
  await tablist.getByRole('tab', { name: /^nutrición$/i }).click()
  const nutPanel = page.getByRole('tabpanel', { name: /nutrición/i })
  await expect(nutPanel.getByTestId('nutrition-unavailable')).toContainText(
    'Aún no podemos calcular la nutrición de esta receta.',
  )
  await expect(nutPanel.getByText(/kcal|proteínas/i)).toHaveCount(0)
})
