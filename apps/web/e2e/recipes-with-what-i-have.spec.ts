/**
 * «Con lo que tengo» (PRO-31): a chip in the `/recipes` filter row opens an
 * ingredient picker; with 2 ingredients chosen the grid shows recipes that
 * use them, each saying what would be missing (basics never count).
 *
 * Hermetic: the user creates their own recipe with two catalogue
 * ingredients + a third one, so it must come back as a result.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding, uniqueId } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
const BASIC = /\b(sal|aceite|agua|pimienta|harina)\b/i

test.use({ viewport: { width: 390, height: 844 } })

test('choosing 2 ingredients lists recipes that use them, with what is missing', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  const all = (await (await page.request.get(`${API_URL}/ingredients?perPage=100`)).json()) as Array<{ id: string; name: string }>
  // Distinct, non-basic names that don't contain one another (so the search finds each one exactly).
  const pool = all.filter((i) => !BASIC.test(i.name) && i.name.length >= 4 && /^[\p{L} ]+$/u.test(i.name))
  const picks: Array<{ id: string; name: string }> = []
  for (const i of pool) {
    if (picks.some((p) => p.name.includes(i.name) || i.name.includes(p.name))) continue
    picks.push(i)
    if (picks.length === 3) break
  }
  expect(picks.length, 'seed has at least 3 ingredients').toBe(3)
  const [a, b, extra] = picks

  const name = `Con lo que tengo ${uniqueId()}`
  // ?force=1: lint findings (step text not naming the ingredients…) become warnings.
  const created = await page.request.post(`${API_URL}/recipes?force=1`, {
    headers: auth,
    data: {
      name,
      servings: 2,
      meals: ['lunch'],
      seasons: [],
      ingredients: [a, b, extra].map((i) => ({ ingredientId: i.id, quantity: 100, unit: 'g' })),
      steps: [{ index: 0, text: `Mezcla ${a.name}, ${b.name} y ${extra.name} y cocina 10 minutos.` }],
    },
  })
  expect(created.status(), await created.text()).toBe(201)

  await page.goto('/recipes')
  const chip = page.getByRole('group', { name: 'Filtros rápidos' }).getByRole('button', { name: 'Con lo que tengo' })
  await expect(chip).toBeVisible({ timeout: 15_000 })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')

  const panel = page.getByRole('region', { name: 'Con lo que tengo' })
  await expect(panel).toContainText('Elige hasta 3 ingredientes')
  const search = panel.getByRole('combobox')
  for (const ing of [a, b]) {
    await search.fill(ing.name)
    await panel.getByRole('option', { name: ing.name, exact: true }).click()
    await expect(panel.getByRole('button', { name: `Quitar ${ing.name}` })).toBeVisible()
  }

  const card = page.getByTestId('recipe-card').filter({ hasText: name })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card.getByTestId('recipe-card-missing')).toHaveText(`Te falta: ${extra.name.toLowerCase()}`)
  // No horizontal scroll at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  // Turning it off brings back the plain catalogue (no "Te falta" lines).
  await chip.click()
  await expect(page.getByTestId('recipe-card-missing')).toHaveCount(0)
})
