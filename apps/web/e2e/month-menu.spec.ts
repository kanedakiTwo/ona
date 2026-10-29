/**
 * PRO-378 · «Menú del mes» (specs/menus.md). This month's menu, as Cocina's
 * import leaves it in `catalog_collections` (written straight into the test
 * database: the import's rules are `monthMenus.test.ts`), shows as a card on
 * /recipes; it opens by days, «Copiar a mi semana» fills the week and /menu
 * shows the dishes. Copying again over a week with dishes asks first.
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
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

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** YYYY-MM in Madrid, as the API reads «this month». */
function madridMonth(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`
}

test.describe('Menú del mes', () => {
  const month = madridMonth()
  const title = `Menú de ${MONTHS[Number(month.slice(5, 7)) - 1]}`
  let lunch = { id: '', name: '' }
  let dinner = { id: '', name: '' }

  test.beforeAll(async () => {
    test.skip(!testDatabaseUrl(), 'needs the test DATABASE_URL')
    await withClient(async (c) => {
      const { rows } = await c.query<{ id: string; name: string }>(
        `SELECT id, name FROM recipes
          WHERE author_id IS NULL AND status = 'published' AND NOT ('retirada' = ANY(COALESCE(internal_tags, ARRAY[]::text[])))
            AND (course IS NULL OR course = 'main')
            AND EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = recipes.id)
          ORDER BY name LIMIT 2`,
      )
      if (rows.length < 2) throw new Error('The seed has no two published catalogue recipes')
      ;[lunch, dinner] = rows
      const week = Array.from({ length: 7 }, () => ({ lunch: [lunch.id], dinner: [dinner.id] }))
      await c.query(`DELETE FROM catalog_collections WHERE kind = 'menu_mes' AND month = $1`, [month])
      await c.query(
        `INSERT INTO catalog_collections (slug, title, kind, month, week) VALUES ($1, $2, 'menu_mes', $3, $4::jsonb)`,
        [`menu-del-mes-${month}`, title, month, JSON.stringify(week)],
      )
    })
  })

  test.afterAll(async () => {
    if (!testDatabaseUrl()) return
    await withClient((c) => c.query(`DELETE FROM catalog_collections WHERE kind = 'menu_mes' AND month = $1`, [month]))
  })

  test('the card on /recipes opens the month, «Copiar a mi semana» fills /menu', async ({ page }) => {
    test.setTimeout(120_000)
    await registerFreshUser(page)
    await completeOnboarding(page)

    await page.goto('/recipes')
    const card = page.getByTestId('month-menu-card')
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card).toContainText(title)
    await card.click()
    await expect(page).toHaveURL(/\/menu\/mes/)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByTestId('month-menu-day')).toHaveCount(7)

    await page.getByRole('button', { name: 'Copiar a mi semana' }).click()
    await expect(page.getByTestId('month-menu-notice')).toContainText('Hemos copiado', { timeout: 20_000 })

    // Again, over a week that has dishes now: it asks first.
    await page.reload()
    await page.getByRole('button', { name: 'Copiar a mi semana' }).click()
    await expect(page.getByText('Se cambiarán los platos de esta semana')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Copiar igualmente' }).click()
    await expect(page.getByTestId('month-menu-notice')).toContainText('Hemos copiado', { timeout: 20_000 })

    await page.getByRole('link', { name: 'Ver mi semana' }).click()
    await expect(page).toHaveURL(/\/menu(\?|$)/)
    await expect(page.getByRole('navigation', { name: 'Días de la semana' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(lunch.name).first()).toBeVisible({ timeout: 20_000 })
  })
})
