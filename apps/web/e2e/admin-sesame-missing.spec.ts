/**
 * PRO-1096: Admin → Alérgenos sugeridos lists, on top, the za'atar & co.
 * stored without «sesamo» with the published recipes that use them. Desktop
 * (the admin lives there). The name rules are in nutritionAllergens.test.ts.
 */

import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

async function loginAsAdmin(page: Page): Promise<string> {
  const r = await page.request.post(`${API_URL}/login`, { data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password } })
  expect(r.ok()).toBeTruthy()
  const { token, user } = await r.json()
  test.skip(user?.role !== 'admin', 'needs ADMIN_EMAILS on the API (see global-setup.ts)')
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('ona_token', t)
      localStorage.setItem('ona_user', u)
    },
    [token, JSON.stringify(user)] as const,
  )
  return token
}

test("Alérgenos sugeridos: a za'atar without sesame shows with the recipe that uses it", async ({ page }) => {
  const token = await loginAsAdmin(page)
  const auth = { Authorization: `Bearer ${token}` }
  const name = `Za'atar e2e ${Date.now()}`

  // A new za'atar gets «sesamo» from its name…
  const created = await page.request.post(`${API_URL}/ingredients/auto-create`, { headers: auth, data: { name } })
  expect(created.ok()).toBeTruthy()
  const { ingredient } = await created.json()
  expect(ingredient.allergenTags).toContain('sesamo')

  // …so drop it by hand, as the old rows were, and use it in a recipe.
  const patched = await page.request.patch(`${API_URL}/ingredients/${ingredient.id}`, { headers: auth, data: { allergenTags: [] } })
  expect(patched.ok()).toBeTruthy()
  const recipe = await page.request.post(`${API_URL}/recipes`, {
    headers: auth,
    data: {
      name: 'Crema con za’atar de prueba',
      servings: 2,
      meals: ['dinner'],
      seasons: ['autumn'],
      equipment: ['cazo'],
      ingredients: [{ ingredientId: ingredient.id, quantity: 5, unit: 'g' }],
      steps: [{ index: 0, text: `Espolvorea el ${name} por encima.` }],
      force: true,
    },
  })
  expect(recipe.status()).toBe(201)
  const { id: recipeId } = await recipe.json()

  try {
    const gaps = await page.request.get(`${API_URL}/admin/ingredient-gaps`, { headers: auth })
    expect(gaps.ok()).toBeTruthy()
    const { sesameMissing } = await gaps.json()
    expect(sesameMissing).toContainEqual(
      expect.objectContaining({ id: ingredient.id, name, currentTags: [], householdRecipes: 1 }),
    )

    await page.goto('/admin')
    await page
      .getByRole('navigation', { name: 'Secciones del admin' })
      .getByRole('button', { name: /Alérgenos sugeridos/ })
      .click()
    const section = page.getByRole('region', { name: 'Sin sésamo' })
    await expect(section).toBeVisible({ timeout: 15_000 })
    await expect(section).toContainText(name)
    await expect(section).toContainText('1 receta de hogares')
  } finally {
    await page.request.delete(`${API_URL}/recipes/${recipeId}`, { headers: auth })
    await page.request.delete(`${API_URL}/ingredients/${ingredient.id}`, { headers: auth })
  }
})
