/**
 * PRO-376: intent chips on /recipes. «Sin gluten» leaves out every recipe
 * with `gluten` in its allergens or with an allergen doubt (the internal tag
 * `alergenos:duda`, sent on the card as `allergenDoubt` and never as a tag).
 * The rules of each chip: catalogSeason.test.ts.
 */
import { test, expect } from '@playwright/test'

const API = process.env.API_URL ?? 'http://localhost:8765'

type Card = { id: string; allergens: string[]; allergenDoubt: boolean; tags: string[] }

test('signed out at 390px: «Sin gluten» shows no recipe with gluten', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const cards: Card[] = await (await page.request.get(`${API}/recipes?perPage=100`)).json()
  expect(cards.length).toBeGreaterThan(0)
  for (const c of cards) {
    expect(typeof c.allergenDoubt).toBe('boolean')
    expect(c.tags).not.toContain('alergenos:duda')
  }
  const withGluten = new Set(cards.filter((c) => c.allergens.includes('gluten') || c.allergenDoubt).map((c) => c.id))
  // The seed has pasta, pizza, bread…: otherwise the check below proves nothing.
  expect(withGluten.size).toBeGreaterThan(0)
  const glutenFree = cards.length - withGluten.size

  await page.goto('/recipes')
  const grid = page.getByTestId('catalog-grid')
  await expect(grid).toBeVisible({ timeout: 20_000 })

  const chip = page.getByRole('button', { name: 'Sin gluten', exact: true })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(new RegExp(`^${glutenFree} recetas?$`))).toBeVisible()

  const shown = await grid
    .getByTestId('recipe-card')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('href') ?? '').split('/').pop()?.split('?')[0] ?? ''))
  expect(shown.length).toBe(glutenFree)
  for (const id of shown) expect(withGluten.has(id), `card ${id} has gluten`).toBe(false)

  // Off again: the whole catalogue is back.
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
})
