/**
 * PRO-1099 · «La receta del día» (specs/recipe-of-the-day.md). A published
 * catalogue recipe with today's `featured_on` (written straight into the
 * test database, as the import leaves it: the import's rules are
 * catalogImport.test.ts) shows in `GET /recipe-of-the-day` and on
 * /receta-del-dia, signed out, with its link preview; a later day without
 * one shows it as «la última», with its date. 390×844.
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { test, expect } from '@playwright/test'
import { testDatabaseUrl } from './_catalogDrafts'

type PgClient = {
  connect(): Promise<void>
  end(): Promise<void>
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}
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

/** AAAA-MM-DD in Madrid, as the API reads «today». */
function madridToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
const NAME = `Lentejas del día de prueba ${Date.now().toString(36)}`

test.describe('La receta del día', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  const today = madridToday()
  let recipeId = ''

  test.beforeAll(async () => {
    test.skip(!testDatabaseUrl(), 'needs the test database')
    recipeId = await withClient(async (c) => {
      // Nothing else may hold today in the test database.
      await c.query(`UPDATE recipes SET featured_on = NULL WHERE featured_on >= $1::date - 1`, [today])
      const { rows: src } = await c.query<{ id: string }>(
        `SELECT r.id FROM recipes r WHERE r.author_id IS NULL AND r.status = 'published'
           AND EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = r.id)
         ORDER BY r.name LIMIT 1`,
      )
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO recipes (name, servings, author_id, status, featured_on, image_url, prep_time, cook_time, total_time, tags, internal_tags, catalog_source)
         SELECT $1, servings, NULL, 'published', $2::date, '/images/recipes/acelgas-rehogadas.jpg', prep_time, cook_time, total_time, tags, internal_tags,
                '{"origin":"cocina","batch":"e2e-del-dia","auditIssues":[],"allergenDoubt":false,"credit":"Receta de la tía Inventada"}'::jsonb
         FROM recipes WHERE id = $3 RETURNING id`,
        [NAME, today, src[0].id],
      )
      await c.query(
        `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, section, quantity, unit, optional, note, display_order)
         SELECT $1, ingredient_id, section, quantity, unit, optional, note, display_order FROM recipe_ingredients WHERE recipe_id = $2`,
        [rows[0].id, src[0].id],
      )
      return rows[0].id
    })
  })

  test.afterAll(async () => {
    if (!recipeId) return
    await withClient((c) => c.query(`DELETE FROM recipes WHERE id = $1`, [recipeId]))
  })

  test('today\'s recipe in the endpoint and on the page, with its link preview', async ({ page, request }) => {
    const api = await request.get(`${API_URL}/recipe-of-the-day`)
    expect(api.status()).toBe(200)
    const view = await api.json()
    expect(view).toMatchObject({ recipeId, title: NAME, date: today, isRequestedDate: true, credit: 'Receta de la tía Inventada' })
    expect(view.keyIngredients.length).toBeGreaterThan(0)
    expect(view.photos.vertical).toMatch(new RegExp(`/receta-del-dia/${today}/foto/vertical$`))

    await page.goto('/receta-del-dia')
    const main = page.getByTestId('recipe-of-the-day')
    await expect(main.getByRole('heading', { level: 1, name: NAME })).toBeVisible()
    await expect(main.getByText('Receta de la tía Inventada')).toBeVisible()
    await expect(page.getByTestId('recipe-of-the-day-ingredients').getByRole('listitem').first()).toBeVisible()
    await expect(page.getByTestId('recipe-of-the-day-fallback')).toHaveCount(0)
    // Signed out: no login wall.
    expect(new URL(page.url()).pathname).toBe('/receta-del-dia')
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', NAME)
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', new RegExp(`/receta-del-dia/${today}/foto/horizontal$`))

    await main.getByRole('link', { name: 'Ver la receta' }).click()
    await expect(page).toHaveURL(new RegExp(`/recipes/${recipeId}$`))
  })

  test('a later day without one shows the last, with its date', async ({ page }) => {
    const later = addDays(today, 3)
    await page.goto(`/receta-del-dia/${later}`)
    await expect(page.getByTestId('recipe-of-the-day').getByRole('heading', { level: 1, name: NAME })).toBeVisible()
    await expect(page.getByTestId('recipe-of-the-day-fallback')).toContainText('no tiene receta del día: esta es la última')
  })
})
