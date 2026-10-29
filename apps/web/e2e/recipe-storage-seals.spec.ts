/**
 * PRO-372 — the ficha's storage seals, in «Notas» under «Conservación»:
 * «Se puede congelar» / «No se congela» and «Aguanta N días en nevera», from
 * `freezable` and `fridgeDays` on GET /recipes/:id. Each one only when there
 * is data. The seed has no seals yet, so the test takes the API's real answer
 * for a catalogue recipe and sets them on it (the API side is covered by
 * catalogImport.test.ts and catalogStorageLabels.test.ts). Signed out
 * (public catalogue), 390×844.
 */

import { test, expect, type Page } from '@playwright/test'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

// The ficha refetches the recipe (e.g. `?servings=4`): a request still in the
// route handler when the test ends must not fail it (PRO-330, CI 2026-10-22).
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

async function openNotesWith(page: Page, seals: { freezable: boolean | null; fridgeDays: number | null }) {
  const list: Array<{ id: string; name: string }> = await (await page.request.get(`${API_URL}/recipes`)).json()
  expect(list.length, 'the seed has catalogue recipes').toBeGreaterThan(0)
  const recipe = list[0]
  await page.route(
    (url) => url.href.startsWith(`${API_URL}/recipes/${recipe.id}`),
    async (route) => {
      const res = await route.fetch()
      const body = await res.json()
      await route.fulfill({ response: res, json: { ...body, ...seals } })
    },
  )
  await page.goto(`/recipes/${recipe.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(recipe.name, { timeout: 15_000 })
  await page.getByRole('tablist').getByRole('tab', { name: /^notas$/i }).click()
  return page.getByRole('tabpanel', { name: /notas/i })
}

test('with data, the ficha shows both seals under «Conservación»', async ({ page }) => {
  const notes = await openNotesWith(page, { freezable: true, fridgeDays: 4 })
  const seals = notes.getByTestId('storage-seals')
  await expect(seals).toBeVisible()
  await expect(notes.getByText('Conservación', { exact: true })).toBeVisible()
  await expect(seals.getByTestId('seal-freezable')).toHaveText('Se puede congelar')
  await expect(seals.getByTestId('seal-fridge-days')).toHaveText('Aguanta 4 días en nevera')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('a dish that doesn\'t freeze says so', async ({ page }) => {
  const notes = await openNotesWith(page, { freezable: false, fridgeDays: 1 })
  await expect(notes.getByTestId('seal-freezable')).toHaveText('No se congela')
  await expect(notes.getByTestId('seal-fridge-days')).toHaveText('Aguanta 1 día en nevera')
})

test('no data, no seals', async ({ page }) => {
  const notes = await openNotesWith(page, { freezable: null, fridgeDays: null })
  await expect(notes).toBeVisible()
  await expect(page.getByTestId('storage-seals')).toHaveCount(0)
  await expect(page.getByTestId('seal-freezable')).toHaveCount(0)
  await expect(page.getByTestId('seal-fridge-days')).toHaveCount(0)
})
