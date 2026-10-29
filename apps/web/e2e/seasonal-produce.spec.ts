/**
 * «Este mes» on `/recipes` (PRO-375, specs/recipes.md): a row with the
 * month's fruits and vegetables above the grid. Tapping one filters the
 * catalogue by that ingredient (`GET /recipes?ingredient=`), with a chip that
 * takes it off again.
 *
 * The page clock is pinned to 8 Oct 2026, so the row is October's whatever
 * month CI runs in. Signed out: the public catalogue has the row too.
 */

import { test, expect } from '@playwright/test'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
const OCTOBER_DAY = new Date('2026-10-08T12:00:00')

test('tapping a product of the month shows only the recipes that use it', async ({ page }) => {
  test.setTimeout(60_000)
  await page.clock.setFixedTime(OCTOBER_DAY)
  await page.goto('/recipes')
  const cards = page.getByTestId('recipe-card')
  await expect(cards.first()).toBeVisible({ timeout: 20_000 })
  const before = await cards.count()

  const row = page.getByRole('group', { name: 'Productos del mes' })
  await expect(row).toBeVisible()
  // October's row, from the calendar: nothing out of season (July's melón, sandía…).
  const produce = (await (await page.request.get(`${apiUrl}/recipes/seasonal-produce?month=10`)).json()) as Array<{
    name: string
    recipeCount: number
  }>
  expect(produce.length).toBeGreaterThan(0)
  await expect(row.getByRole('button')).toHaveCount(produce.length)
  await expect(row.getByRole('button', { name: 'Sandía' })).toHaveCount(0)

  const { name } = produce[0]
  const product = row.getByRole('button', { name, exact: true })
  await product.click()
  await expect(product).toHaveAttribute('aria-pressed', 'true')
  const chip = page.getByRole('button', { name: `Quitar ${name}` })
  await expect(chip).toBeVisible()

  // The grid is exactly what the API filters by that ingredient.
  const filtered = (await (
    await page.request.get(`${apiUrl}/recipes?ingredient=${encodeURIComponent(name)}&perPage=100`)
  ).json()) as Array<{ id: string }>
  expect(filtered.length).toBeGreaterThanOrEqual(3)
  await expect(cards).toHaveCount(filtered.length)
  const hrefs = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('href')))
  expect(hrefs.sort()).toEqual(filtered.map((r) => `/recipes/${r.id}`).sort())
  await expect(page.getByText(`${filtered.length} recetas`, { exact: true })).toBeVisible()

  // The chip takes the filter off: the whole catalogue is back.
  await chip.click()
  await expect(chip).toHaveCount(0)
  await expect(product).toHaveAttribute('aria-pressed', 'false')
  await expect(cards).toHaveCount(before)
})
