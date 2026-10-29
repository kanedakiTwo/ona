/**
 * PRO-376: intent chips on /recipes. «Sin gluten» leaves out every recipe
 * with `gluten` in its allergens or with an allergen doubt (the internal tag
 * `alergenos:duda`, sent on the card as `allergenDoubt` and never as a tag).
 * The rules of each chip: catalogSeason.test.ts.
 *
 * The seed's recipes carry no stored `gluten`, so the spec writes three
 * published catalogue recipes into the test database (copies of a seeded one,
 * like `_catalogDrafts.ts`): one with gluten, one in doubt, one without.
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { test, expect } from '@playwright/test'
import { testDatabaseUrl } from './_catalogDrafts'

const API = process.env.API_URL ?? 'http://localhost:8765'
const PREFIX = 'Prueba376'

type PgClient = {
  connect(): Promise<void>
  end(): Promise<void>
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}
type Card = { id: string; name: string; allergens: string[]; allergenDoubt: boolean; tags: string[] }

const requireFromApi = createRequire(path.join(__dirname, '..', '..', 'api', 'package.json'))

async function withClient<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
  const { Client } = requireFromApi('pg') as { Client: new (o: { connectionString: string }) => PgClient }
  const c = new Client({ connectionString: testDatabaseUrl()! })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

const RECIPES = [
  { name: `${PREFIX} pan con tomate`, allergens: ['gluten'], internalTags: [] as string[] },
  { name: `${PREFIX} guiso dudoso`, allergens: [] as string[], internalTags: ['alergenos:duda'] },
  { name: `${PREFIX} tortilla`, allergens: ['huevo'], internalTags: [] as string[] },
]
let ids: string[] = []

test.beforeAll(async () => {
  if (!testDatabaseUrl()) return
  ids = await withClient(async (c) => {
    const { rows: src } = await c.query<{ id: string }>(
      `SELECT id FROM recipes WHERE author_id IS NULL AND status = 'published' ORDER BY name LIMIT 1`,
    )
    if (!src[0]) throw new Error('The seed has no published catalogue recipe to copy')
    const { rows: cols } = await c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recipes' ORDER BY ordinal_position`,
    )
    const skip = ['id', 'name', 'allergens', 'internal_tags', 'status', 'created_at', 'updated_at']
    const copy = cols.map((r) => r.column_name).filter((n) => !skip.includes(n)).map((n) => `"${n}"`).join(', ')
    const out: string[] = []
    for (const r of RECIPES) {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO recipes (name, allergens, internal_tags, status, ${copy})
         SELECT $1, $2::text[], $3::text[], 'published', ${copy} FROM recipes WHERE id = $4 RETURNING id`,
        [r.name, r.allergens, r.internalTags, src[0].id],
      )
      out.push(rows[0].id)
    }
    return out
  })
})

test.afterAll(async () => {
  if (!testDatabaseUrl() || ids.length === 0) return
  await withClient((c) => c.query(`DELETE FROM recipes WHERE id = ANY($1::uuid[])`, [ids]))
})

test('signed out at 390px: «Sin gluten» shows no recipe with gluten', async ({ page }) => {
  test.skip(!testDatabaseUrl(), 'No test database to write the recipes to')
  await page.setViewportSize({ width: 390, height: 844 })

  // The card says it without leaking the internal tag.
  const cards: Card[] = await (await page.request.get(`${API}/recipes?perPage=100&search=${PREFIX}`)).json()
  expect(cards.map((c) => c.name).sort()).toEqual(RECIPES.map((r) => r.name).sort())
  const doubt = cards.find((c) => c.name === RECIPES[1].name)!
  expect(doubt.allergenDoubt).toBe(true)
  expect(doubt.tags).not.toContain('alergenos:duda')
  expect('internalTags' in doubt).toBe(false)

  await page.goto('/recipes')
  const grid = page.getByTestId('catalog-grid')
  await expect(grid).toBeVisible({ timeout: 20_000 })
  await page.getByRole('textbox', { name: 'Buscar recetas' }).fill(PREFIX)
  await expect(grid.getByTestId('recipe-card')).toHaveCount(3, { timeout: 10_000 })

  const chip = page.getByRole('button', { name: 'Sin gluten', exact: true })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(grid.getByTestId('recipe-card')).toHaveCount(1)
  await expect(grid.getByTestId('recipe-card')).toContainText(RECIPES[2].name)

  // Whole catalogue with «Sin gluten» on: no card with gluten or in doubt.
  await page.getByRole('textbox', { name: 'Buscar recetas' }).fill('')
  const all: Card[] = await (await page.request.get(`${API}/recipes?perPage=100`)).json()
  const withGluten = new Set(all.filter((c) => c.allergens.includes('gluten') || c.allergenDoubt).map((c) => c.id))
  await expect(page.getByText(new RegExp(`^${all.length - withGluten.size} recetas?$`))).toBeVisible({ timeout: 10_000 })
  const shown = await grid
    .getByTestId('recipe-card')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('href') ?? '').split('/').pop()?.split('?')[0] ?? ''))
  expect(shown.length).toBeGreaterThan(0)
  for (const id of shown) expect(withGluten.has(id), `card ${id} has gluten`).toBe(false)
})
