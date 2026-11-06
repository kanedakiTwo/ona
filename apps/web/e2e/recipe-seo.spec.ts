/**
 * PRO-1077 — SEO de la ficha (specs/recipes.md): the server HTML of a
 * catalogue recipe (before any JavaScript runs) carries its title, canonical
 * and the `schema.org/Recipe` JSON-LD, and `/sitemap.xml` lists the published
 * catalogue recipes. Book recipes staying out (D-104) is in
 * apps/api/src/tests/recipeSeo.test.ts.
 */

import { test, expect } from '@playwright/test'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

// Raw server HTML through `next dev`: the first hit of a route compiles it.
test.describe.configure({ timeout: 90_000 })

async function sitemapRecipeIds(request: import('@playwright/test').APIRequestContext): Promise<string[]> {
  const res = await request.get(`${API_URL}/recipes/sitemap`)
  expect(res.ok()).toBe(true)
  const rows = (await res.json()) as Array<{ id: string }>
  expect(rows.length, 'seeded catalogue recipes').toBeGreaterThan(0)
  return rows.map((r) => r.id)
}

test('the server HTML of a catalogue recipe has its title, canonical and a valid Recipe JSON-LD', async ({ request }) => {
  const [recipe] = await (await request.get(`${API_URL}/recipes?perPage=1`)).json()
  expect(recipe?.id, 'seeded catalogue recipe').toBeTruthy()

  const res = await request.get(`/recipes/${recipe.id}`, { timeout: 60_000 })
  expect(res.ok()).toBe(true)
  const html = await res.text()

  expect(html).toContain(`<link rel="canonical" href="https://mimoia.com/recipes/${recipe.id}"/>`)
  expect(html).toMatch(/<title>[^<]+ · Mimoia<\/title>/)

  const match = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)
  expect(match, 'JSON-LD in the server HTML').not.toBeNull()
  const ld = JSON.parse(match![1])
  expect(ld['@context']).toBe('https://schema.org')
  expect(ld['@type']).toBe('Recipe')
  expect(ld.name).toBe(recipe.name)
  expect(ld.url).toBe(`https://mimoia.com/recipes/${recipe.id}`)
  expect(ld.author).toMatchObject({ '@type': 'Organization', name: 'Mimoia' })
  expect(ld.recipeIngredient.length).toBeGreaterThan(0)
  expect(ld.recipeInstructions.length).toBeGreaterThan(0)
  expect(ld.recipeInstructions[0]).toMatchObject({ '@type': 'HowToStep', position: 1 })
})

test('sitemap.xml lists the catalogue recipes', async ({ request }) => {
  const ids = await sitemapRecipeIds(request)
  const res = await request.get('/sitemap.xml', { timeout: 60_000 })
  expect(res.ok()).toBe(true)
  const xml = await res.text()
  expect(xml).toContain('<loc>https://mimoia.com/recipes</loc>')
  for (const id of ids.slice(0, 3)) expect(xml).toContain(`<loc>https://mimoia.com/recipes/${id}</loc>`)
})
