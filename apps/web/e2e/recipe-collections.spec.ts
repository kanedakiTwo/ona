/**
 * «Colecciones» of the catalogue (PRO-374, specs/recipes.md → «Colecciones»):
 * a collection uploaded from Admin (`POST /admin/catalog-collections`, the
 * same call «Subir colección» makes) shows as a card in the row of `/recipes`
 * and opens `/recipes/coleccion/<slug>` with its recipes, in its order —
 * without an account. The upload of one that talks about health is refused.
 * At the end the collection is uploaded again unpublished, so it leaves the row.
 */

import { test, expect } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'
import { uniqueId } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('signed out: the row shows a collection and it opens with its recipes', async ({ page }) => {
    const login = await page.request.post(`${API_URL}/login`, { data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password } })
    expect(login.ok()).toBeTruthy()
    const { token, user } = await login.json()
    test.skip(user?.role !== 'admin', 'needs ADMIN_EMAILS on the API (see global-setup.ts)')
    const auth = { Authorization: `Bearer ${token}` }

    // Two published catalogue recipes, as anyone sees them.
    const list = await page.request.get(`${API_URL}/recipes?perPage=10`)
    expect(list.ok()).toBeTruthy()
    const recipes = (await list.json()) as Array<{ id: string; name: string }>
    test.skip(recipes.length < 2, 'needs the seeded catalogue')
    const [first, second] = [recipes[1], recipes[0]]

    const tag = uniqueId().toLowerCase().replace(/[^a-z0-9]/g, '')
    const slug = `e2e-${tag}`.slice(0, 60)
    const title = `Invitados en casa ${tag}`
    const file = { slug, title, subtitle: 'Para cuando viene gente', recipes: [first.id, second.id] }

    // §6: no collection by health.
    const health = await page.request.post(`${API_URL}/admin/catalog-collections`, { headers: auth, data: { ...file, title: 'Cenas para perder grasa' } })
    expect(health.status()).toBe(400)
    expect((await health.json()).problems[0]).toContain('perder grasa')

    const saved = await page.request.post(`${API_URL}/admin/catalog-collections`, { headers: auth, data: file })
    expect(saved.status()).toBe(201)
    try {
      // The browser has no session: the public catalogue.
      await page.goto('/recipes')
      const row = page.getByTestId('collections-row')
      await expect(row.getByRole('heading', { name: 'Colecciones' })).toBeVisible({ timeout: 20_000 })
      const card = row.getByTestId('collection-card').filter({ hasText: title })
      await expect(card).toBeVisible()
      await expect(card).toContainText('2 recetas')

      await card.click()
      await expect(page).toHaveURL(new RegExp(`/recipes/coleccion/${slug}$`))
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Para cuando viene gente')).toBeVisible()
      const cards = page.locator(`a[href="/recipes/${first.id}"], a[href="/recipes/${second.id}"]`)
      await expect(cards.first()).toBeVisible()
      await expect(page.getByText(first.name).first()).toBeVisible()
      await expect(page.getByText(second.name).first()).toBeVisible()
      // Not sent to the login: still signed out, public chrome.
      await expect(page).not.toHaveURL(/\/login/)
    } finally {
      await page.request.post(`${API_URL}/admin/catalog-collections`, { headers: auth, data: { ...file, published: false } })
    }
    expect((await page.request.get(`${API_URL}/catalog-collections/${slug}`)).status()).toBe(404)
  })
})
