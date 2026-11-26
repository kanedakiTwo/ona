/**
 * PRO-373 — a dish that uses a base cooked another day (sofrito, verduras
 * asadas…) says so on its ficha: «Usa: Sofrito (2 raciones)», with a link to
 * the base. The seed has no `recipe_bases` row, so the test takes the API's
 * real answer for a catalogue recipe and sets `bases` on it, pointing at
 * another catalogue recipe (the API side is covered by recipeBases.test.ts).
 * Signed out (public catalogue), 390×844.
 */

import { test, expect } from '@playwright/test'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

// The ficha refetches the recipe (e.g. `?servings=4`): a request still in the
// route handler when the test ends must not fail it (PRO-330).
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('the ficha names the base it uses and opens it', async ({ page }) => {
  const list: Array<{ id: string; name: string }> = await (await page.request.get(`${API_URL}/recipes`)).json()
  expect(list.length, 'the seed has two catalogue recipes at least').toBeGreaterThan(1)
  const [dish, base] = list
  await page.route(
    (url) => url.href.startsWith(`${API_URL}/recipes/${dish.id}`),
    async (route) => {
      const res = await route.fetch()
      const body = await res.json()
      await route.fulfill({ response: res, json: { ...body, bases: [{ id: base.id, name: base.name, servings: 2 }] } })
    },
  )
  await page.goto(`/recipes/${dish.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(dish.name, { timeout: 15_000 })

  const line = page.getByTestId('recipe-bases')
  await expect(line).toHaveText(`Usa: ${base.name} (2 raciones)`)
  await expect(line).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await line.getByRole('link', { name: base.name }).click()
  await expect(page).toHaveURL(new RegExp(`/recipes/${base.id}$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(base.name, { timeout: 15_000 })
})

test('no bases, no line', async ({ page }) => {
  const list: Array<{ id: string; name: string }> = await (await page.request.get(`${API_URL}/recipes`)).json()
  await page.goto(`/recipes/${list[0].id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(list[0].name, { timeout: 15_000 })
  await expect(page.getByTestId('recipe-bases')).toHaveCount(0)
})
