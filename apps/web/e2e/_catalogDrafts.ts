/**
 * Catalogue drafts for the admin «Recetas pendientes» specs, written straight
 * into the test database: the real import needs the AI (no key in CI), so the
 * spec starts from drafts as the import leaves them — a copy of a seeded
 * catalogue recipe (ingredients and steps included) with `status = 'draft'`,
 * its batch and `catalog_source`. Invented names only.
 *
 * Uses the API workspace's `pg` and the DATABASE_URL the API runs on (the CI
 * e2e job and scripts/test-e2e.sh export it). Refuses any non-local database.
 */
import path from 'node:path'
import { createRequire } from 'node:module'

type PgClient = {
  connect(): Promise<void>
  end(): Promise<void>
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

const requireFromApi = createRequire(path.join(__dirname, '..', '..', 'api', 'package.json'))

/** Null when the spec has no database to write to (it then skips). */
export function testDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL
  if (!url) return null
  const host = new URL(url).hostname
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`Refusing to write e2e drafts to a non-local database (${host})`)
  return url
}

async function withClient<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
  const url = testDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is not set')
  const { Client } = requireFromApi('pg') as { Client: new (o: { connectionString: string }) => PgClient }
  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

async function columns(c: PgClient, table: string, skip: string[]): Promise<string[]> {
  const { rows } = await c.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  )
  return rows.map((r) => r.column_name).filter((n) => !skip.includes(n)).map((n) => `"${n}"`)
}

export interface SeedDraft {
  name: string
  allergenDoubt?: boolean
  auditIssues?: string[]
  credit?: string
  /** As an import leaves it before its photo is made (default: with the source's photo). */
  noPhoto?: boolean
}

/** Drafts in `batch`, in this order; returns their ids. */
export async function seedCatalogDrafts(batch: string, drafts: SeedDraft[]): Promise<string[]> {
  return withClient(async (c) => {
    const { rows: src } = await c.query<{ id: string }>(
      `SELECT r.id FROM recipes r WHERE r.author_id IS NULL AND r.status = 'published'
         AND EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = r.id)
       ORDER BY r.name LIMIT 1`,
    )
    if (!src[0]) throw new Error('The seed has no published catalogue recipe to copy')
    const recipeCols = (await columns(c, 'recipes', ['id', 'name', 'status', 'import_batch', 'catalog_source', 'image_url', 'created_at', 'updated_at'])).join(', ')
    const ingCols = (await columns(c, 'recipe_ingredients', ['id', 'recipe_id'])).join(', ')
    const stepCols = (await columns(c, 'recipe_steps', ['id', 'recipe_id', 'ingredient_refs'])).join(', ')
    const ids: string[] = []
    for (const d of drafts) {
      const source = { origin: 'cocina', book: 'Cuaderno de pruebas', batch, auditIssues: d.auditIssues ?? [], allergenDoubt: !!d.allergenDoubt, ...(d.credit ? { credit: d.credit } : {}) }
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO recipes (name, status, import_batch, catalog_source, image_url, ${recipeCols})
         SELECT $1, 'draft', $2, $3::jsonb, CASE WHEN $5::boolean THEN NULL ELSE COALESCE(image_url, '/images/recipes/prueba.jpg') END, ${recipeCols}
         FROM recipes WHERE id = $4 RETURNING id`,
        [d.name, batch, JSON.stringify(source), src[0].id, !!d.noPhoto],
      )
      const id = rows[0].id
      await c.query(`INSERT INTO recipe_ingredients (recipe_id, ${ingCols}) SELECT $1, ${ingCols} FROM recipe_ingredients WHERE recipe_id = $2`, [id, src[0].id])
      await c.query(`INSERT INTO recipe_steps (recipe_id, ingredient_refs, ${stepCols}) SELECT $1, ARRAY[]::uuid[], ${stepCols} FROM recipe_steps WHERE recipe_id = $2`, [id, src[0].id])
      ids.push(id)
    }
    return ids
  })
}

/** Remove what a spec created (recipes cascade to their ingredients and steps). */
export async function removeCatalogDrafts(ids: string[], batch: string): Promise<void> {
  if (!testDatabaseUrl()) return
  await withClient(async (c) => {
    await c.query(`DELETE FROM admin_audit_log WHERE target_id = ANY($1::text[]) OR target_id = $2`, [ids, batch])
    await c.query(`UPDATE catalog_wishes SET status = 'abierto', recipe_id = NULL WHERE recipe_id = ANY($1::uuid[])`, [ids])
    await c.query(`DELETE FROM recipes WHERE id = ANY($1::uuid[])`, [ids])
  })
}
