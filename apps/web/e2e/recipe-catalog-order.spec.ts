/**
 * PRO-140: the public catalogue (/recipes signed out) shows the recipes in
 * the API's order — households with it in favourites, then Miguel's
 * featured list (`FEATURED_RECIPES`), then the rest; the page doesn't
 * re-sort (the seasonal «De temporada» hero, if any, is set apart). The rule
 * itself: recipeCatalogOrder.test.ts + recipeCatalogOrder.smoke.ts (real DB).
 */
import { test, expect } from '@playwright/test'

const API = process.env.API_URL ?? 'http://localhost:8765'

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`signed out at ${viewport.width}px: the grid follows the catalogue order, featured first`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const api: Array<{ id: string; name: string }> = await (await page.request.get(`${API}/recipes?perPage=100`)).json()
    expect(api.length).toBeGreaterThan(0)

    await page.goto('/recipes')
    const grid = page.getByTestId('catalog-grid')
    await expect(grid).toBeVisible({ timeout: 20_000 })
    const heroIds = await page
      .getByTestId('featured-recipe')
      .evaluateAll((els) => els.map((e) => (e.getAttribute('href') ?? e.querySelector('a')?.getAttribute('href') ?? '').split('/').pop()?.split('?')[0]))
    const expected = api.filter((r) => !heroIds.includes(r.id))
    const firstCard = grid.getByTestId('recipe-card').first()
    await expect(firstCard).toHaveAttribute('href', new RegExp(`/recipes/${expected[0].id}`))
  })
}
