/**
 * PRO-1118: saving an ingredient's allergens in Admin recomputes the recipes
 * that use it (their ficha says it, ingredients and steps untouched), and
 * Admin → Alérgenos sugeridos counts the recipes whose stored allergens still
 * don't match. Desktop (the admin lives there). The DB path is in
 * apps/api/src/tests/recipeAllergenSync.smoke.ts.
 */

import path from 'node:path'
import { createRequire } from 'node:module'
import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'
import { testDatabaseUrl } from './_catalogDrafts'

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

/** A stale union, as the recipes saved before PRO-1118 were: straight into the test database. */
async function clearStoredAllergens(recipeId: string): Promise<void> {
  const requireFromApi = createRequire(path.join(__dirname, '..', '..', 'api', 'package.json'))
  const { Client } = requireFromApi('pg') as {
    Client: new (o: { connectionString: string }) => {
      connect(): Promise<void>
      end(): Promise<void>
      query(sql: string, params?: unknown[]): Promise<unknown>
    }
  }
  const c = new Client({ connectionString: testDatabaseUrl()! })
  await c.connect()
  try {
    await c.query(`UPDATE recipes SET allergens = '{}' WHERE id = $1`, [recipeId])
  } finally {
    await c.end()
  }
}

test('an ingredient gets sesame: the two recipes that use it say it, and the count shows a stale one', async ({ page }) => {
  const token = await loginAsAdmin(page)
  const auth = { Authorization: `Bearer ${token}` }
  // A neutral name: nothing in it says sesame, so only the stored tags count.
  const name = `Mezcla de especias e2e ${Date.now()}`

  const created = await page.request.post(`${API_URL}/ingredients/auto-create`, { headers: auth, data: { name } })
  expect(created.ok()).toBeTruthy()
  const { ingredient } = await created.json()
  expect(ingredient.allergenTags ?? []).not.toContain('sesamo')

  const recipeIds: string[] = []
  for (const dish of ['Crema', 'Ensalada']) {
    const r = await page.request.post(`${API_URL}/recipes`, {
      headers: auth,
      data: {
        name: `${dish} con especias de prueba`,
        servings: 2,
        meals: ['dinner'],
        seasons: ['autumn'],
        equipment: ['cazo'],
        ingredients: [{ ingredientId: ingredient.id, quantity: 5, unit: 'g' }],
        steps: [{ index: 0, text: `Espolvorea la ${name} por encima.` }],
        force: true,
      },
    })
    expect(r.status()).toBe(201)
    recipeIds.push((await r.json()).id)
  }
  const detail = async (id: string) => {
    const r = await page.request.get(`${API_URL}/recipes/${id}`, { headers: auth })
    expect(r.ok()).toBeTruthy()
    return r.json()
  }

  try {
    const before = await Promise.all(recipeIds.map(detail))
    for (const r of before) expect(r.allergens).not.toContain('sesamo')

    const patched = await page.request.patch(`${API_URL}/ingredients/${ingredient.id}`, {
      headers: auth,
      data: { allergenTags: ['sesamo'] },
    })
    expect(patched.ok()).toBeTruthy()

    const after = await Promise.all(recipeIds.map(detail))
    after.forEach((r, i) => {
      expect(r.allergens).toContain('sesamo')
      expect(r.ingredients).toEqual(before[i].ingredients)
      expect(r.steps).toEqual(before[i].steps)
    })

    test.skip(!testDatabaseUrl(), 'needs DATABASE_URL (the API test database) for the stale recipe')
    const gapsBefore = await (await page.request.get(`${API_URL}/admin/ingredient-gaps`, { headers: auth })).json()
    await clearStoredAllergens(recipeIds[0])
    const gaps = await page.request.get(`${API_URL}/admin/ingredient-gaps`, { headers: auth })
    expect(gaps.ok()).toBeTruthy()
    const { allergenMismatch } = await gaps.json()
    expect(allergenMismatch.total).toBe(gapsBefore.allergenMismatch.total + 1)
    expect(allergenMismatch.householdRecipes).toBe(gapsBefore.allergenMismatch.householdRecipes + 1)

    await page.goto('/admin')
    await page
      .getByRole('navigation', { name: 'Secciones del admin' })
      .getByRole('button', { name: /Alérgenos sugeridos/ })
      .click()
    const section = page.getByRole('region', { name: 'Alérgenos descuadrados' })
    await expect(section).toBeVisible({ timeout: 15_000 })
    await expect(section).toContainText(`Alérgenos descuadrados: ${allergenMismatch.total}`)
    await expect(section).toContainText(/recetas? de hogares/)
  } finally {
    for (const id of recipeIds) await page.request.delete(`${API_URL}/recipes/${id}`, { headers: auth })
    await page.request.delete(`${API_URL}/ingredients/${ingredient.id}`, { headers: auth })
  }
})
