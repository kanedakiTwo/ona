/**
 * PRO-32 — the recipe detail says what is estimated: servings the importer
 * guessed carry «Estimado», an ingredient without an amount reads «cantidad
 * sin indicar» (never «0 g»), the Nutrición tab says it is an estimate and
 * not medical advice, and «Ver fuente» stays under the title.
 * Mobile, 390×844.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function findIngredient(
  page: import('@playwright/test').Page,
  search: string,
  exact?: string,
): Promise<{ id: string; name: string }> {
  const found: Array<{ id: string; name: string }> = await (
    await page.request.get(`${API_URL}/ingredients?search=${encodeURIComponent(search)}&perPage=50`)
  ).json()
  const hit = exact ? found.find((i) => i.name === exact) : found[0]
  expect(hit, `seed has "${exact ?? search}"`).toBeTruthy()
  return hit!
}

test('recipe detail: «Estimado», «cantidad sin indicar» and the nutrition note', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  const ternera = await findIngredient(page, 'ternera', 'ternera')
  const other = await findIngredient(page, 'cebolla')

  const created = await page.request.post(`${API_URL}/recipes`, {
    headers: auth,
    data: {
      name: 'Guiso estimado de prueba',
      servings: 4,
      servingsConfidence: 'estimated',
      sourceUrl: 'https://example.com/guiso',
      sourceType: 'article',
      meals: ['lunch'],
      seasons: ['winter'],
      equipment: ['cazuela'],
      ingredients: [
        { ingredientId: ternera.id, quantity: 400, unit: 'g' },
        { ingredientId: other.id, quantity: 0, unit: 'g' },
      ],
      steps: [{ index: 0, text: 'Guisa la ternera con la cebolla.' }],
      force: true,
    },
  })
  expect(created.status()).toBe(201)
  const recipe = await created.json()
  expect(recipe.servingsConfidence).toBe('estimated')

  await page.goto(`/recipes/${recipe.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Guiso estimado de prueba', { timeout: 15_000 })

  // «Ver fuente» under the title.
  await expect(page.getByRole('link', { name: /ver fuente/i })).toHaveAttribute('href', 'https://example.com/guiso')

  // Ingredientes: «Estimado» next to the servings; the amountless line.
  const ingPanel = page.getByRole('tabpanel', { name: /ingredientes/i })
  await expect(ingPanel.getByTestId('servings-estimated')).toHaveText(/estimado/i)
  await expect(ingPanel.getByText('cantidad sin indicar')).toBeVisible()
  await expect(ingPanel.getByText(/^0 g$/)).toHaveCount(0)

  // Nutrición: the estimate / not-medical-advice line.
  const tablist = page.getByRole('tablist', { name: /secciones de la receta/i })
  await tablist.getByRole('tab', { name: /^nutrición$/i }).click()
  const nutPanel = page.getByRole('tabpanel', { name: /nutrición/i })
  await expect(nutPanel.getByTestId('nutrition-estimate-note')).toHaveText(
    'Estimación a partir de los ingredientes; no es consejo médico.',
  )

  // A recipe whose servings were stated carries no «Estimado».
  const explicit = await page.request.post(`${API_URL}/recipes`, {
    headers: auth,
    data: {
      name: 'Guiso con raciones de prueba',
      servings: 2,
      meals: ['lunch'],
      seasons: ['winter'],
      equipment: ['cazuela'],
      ingredients: [{ ingredientId: ternera.id, quantity: 300, unit: 'g' }],
      steps: [{ index: 0, text: 'Guisa la ternera.' }],
      force: true,
    },
  })
  expect(explicit.status()).toBe(201)
  await page.goto(`/recipes/${(await explicit.json()).id}`)
  await expect(page.getByRole('group', { name: 'Raciones' }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('servings-estimated')).toHaveCount(0)
})
