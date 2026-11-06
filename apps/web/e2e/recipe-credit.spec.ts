/**
 * D-067 — the ficha says where a catalogue recipe comes from («Receta de la
 * Yaya», «Inspirada en una receta de <autor>, «<libro>»»): one line right
 * under the title, from `sourceCredit` on GET /recipes/:id. The seed has no
 * batch-imported recipe, so the test takes the API's real answer for a
 * catalogue recipe and sets the line on it (the API side is covered by
 * catalogImport.test.ts + catalogImport.smoke.ts). Invented text only.
 * With the original's link (`sourceUrl`), the credit is a link to it
 * (PRO-1075). Signed out (public catalogue), 390×844.
 */

import { test, expect, type Page } from '@playwright/test'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
const CREDIT = 'Inspirada en una receta de Autora Inventada, «Cuaderno de pruebas»'
const ORIGINAL = 'https://example.com/receta-inventada'

test.use({ viewport: { width: 390, height: 844 } })

// The ficha refetches the recipe (e.g. `?servings=4`): a request still in the
// route handler when the test ends must not fail it (PRO-330, CI 2026-10-22).
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

async function openWithCredit(page: Page, credit: string | null, sourceUrl: string | null = null) {
  const list: Array<{ id: string; name: string }> = await (await page.request.get(`${API_URL}/recipes`)).json()
  expect(list.length, 'the seed has catalogue recipes').toBeGreaterThan(0)
  const recipe = list[0]
  const sent: Array<Record<string, unknown>> = []
  await page.route(
    (url) => url.href.startsWith(`${API_URL}/recipes/${recipe.id}`),
    async (route) => {
      const res = await route.fetch()
      const body = await res.json()
      sent.push(body)
      await route.fulfill({ response: res, json: { ...body, sourceCredit: credit, sourceUrl } })
    },
  )
  await page.goto(`/recipes/${recipe.id}`)
  const title = page.getByRole('heading', { level: 1 })
  await expect(title).toHaveText(recipe.name, { timeout: 15_000 })
  // The API sends the field, and nothing else of the batch-import source.
  expect(sent.length).toBeGreaterThan(0)
  expect(sent[0]).toHaveProperty('sourceCredit')
  expect(sent[0]).not.toHaveProperty('catalogSource')
  return title
}

test('the ficha shows where the recipe comes from, right under the title', async ({ page }) => {
  const title = await openWithCredit(page, CREDIT)
  const credit = page.getByTestId('recipe-credit')
  await expect(credit).toHaveText(CREDIT)
  await expect(credit).toBeInViewport()

  const t = (await title.boundingBox())!
  const c = (await credit.boundingBox())!
  expect(c.y).toBeGreaterThanOrEqual(t.y + t.height - 1)
  expect(c.y - (t.y + t.height)).toBeLessThan(24)
  // A long credit wraps; the page never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('no credit, no line', async ({ page }) => {
  await openWithCredit(page, null)
  await expect(page.getByTestId('recipe-credit')).toHaveCount(0)
})

test("with the original's link, the credit opens it in a new tab", async ({ page }) => {
  await openWithCredit(page, CREDIT, ORIGINAL)
  const link = page.getByTestId('recipe-credit').getByRole('link', { name: CREDIT })
  await expect(link).toHaveAttribute('href', ORIGINAL)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  // «Ver fuente» stays below.
  await expect(page.getByRole('link', { name: /Ver fuente/ })).toHaveAttribute('href', ORIGINAL)
})

test('without the link, the credit is plain text', async ({ page }) => {
  await openWithCredit(page, CREDIT, null)
  const credit = page.getByTestId('recipe-credit')
  await expect(credit).toHaveText(CREDIT)
  await expect(credit.locator('a')).toHaveCount(0)
})
