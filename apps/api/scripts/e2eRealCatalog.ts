/**
 * PRO-397: the e2e «catálogo real» (apps/web/e2e/real-catalog.spec.ts) runs
 * against a copy of staging's recipe catalogue (staging carries production's,
 * `sync-staging-catalog.sh`) instead of the small seed. This prepares that
 * copy in its own database, so the rest of the suite keeps the seed:
 *
 *   DATABASE_URL=<catalogue db> CREATE_FROM_DATABASE_URL=<suite db> \
 *     tsx scripts/e2eRealCatalog.ts [--source https://ona-api-staging.up.railway.app]
 *
 *   1. creates the database if it doesn't exist (connecting through
 *      CREATE_FROM_DATABASE_URL, the suite's, which in CI is the superuser);
 *   2. applies the migrations (`db:migrate`, with its backfills);
 *   3. if it has no catalogue recipes yet, copies them from the source's
 *      public API: every ingredient (`GET /ingredients`) and every published
 *      catalogue recipe (`GET /recipes`, then `GET /recipes/:id` for its
 *      ingredients and steps). Only what any visitor already sees; no users.
 *
 * Prints one JSON line `{ recipes, ingredients, copied }` at the end. Exit 1
 * on any failure (staging down too): the e2e must not pass on an empty copy.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DEFAULT_SOURCE = 'https://ona-api-staging.up.railway.app'

/* ── Pure: API JSON → rows ─────────────────────────────────── */

export interface ApiIngredient {
  id: string
  name: string
  [k: string]: unknown
}

export interface ApiRecipeListItem {
  id: string
  name: string
  authorId: string | null
  course?: string | null
}

export interface ApiRecipeDetail {
  id: string
  name: string
  authorId: string | null
  imageUrl?: string | null
  servings: number
  servingsConfidence?: 'explicit' | 'estimated'
  difficulty?: string | null
  meals?: string[]
  seasons?: string[]
  mealFit?: unknown
  seasonFit?: unknown
  frequency?: string | null
  equipment?: string[]
  allergens?: string[]
  nutritionPerServing?: unknown
  nutritionIncomplete?: boolean
  tags?: string[]
  internalTags?: string[]
  prepTime?: number | null
  cookTime?: number | null
  activeTime?: number | null
  totalTime?: number | null
  freezable?: boolean | null
  fridgeDays?: number | null
  ingredients?: Array<{
    id: string
    ingredientId: string
    quantity: number
    unit: string
    optional?: boolean
    displayOrder?: number
    note?: string | null
    section?: string | null
  }>
  steps?: Array<{
    index: number
    text: string
    durationMin?: number | null
    temperature?: number | null
    technique?: string | null
    ingredientRefs?: string[] | null
  }>
}

/** Columns of `ingredients` copied as they come (snake_case ← camelCase). */
const INGREDIENT_COLUMNS: Array<[string, string, 'json' | 'plain']> = [
  ['id', 'id', 'plain'],
  ['name', 'name', 'plain'],
  ['category', 'category', 'plain'],
  ['fdc_id', 'fdcId', 'plain'],
  ['aisle', 'aisle', 'plain'],
  ['density', 'density', 'plain'],
  ['unit_weight', 'unitWeight', 'plain'],
  ['edible_fraction', 'edibleFraction', 'plain'],
  ['allergen_tags', 'allergenTags', 'plain'],
  ['contains_tags', 'containsTags', 'plain'],
  ['calories', 'calories', 'plain'],
  ['protein', 'protein', 'plain'],
  ['carbs', 'carbs', 'plain'],
  ['fat', 'fat', 'plain'],
  ['fiber', 'fiber', 'plain'],
  ['salt', 'salt', 'plain'],
  ['seasons', 'seasons', 'plain'],
  ['vitamins', 'vitamins', 'json'],
  ['minerals', 'minerals', 'json'],
  ['amino_acids', 'aminoAcids', 'json'],
  ['fat_acids', 'fatAcids', 'json'],
  ['carb_types', 'carbTypes', 'json'],
  ['prep_requirements', 'prepRequirements', 'json'],
]

export interface Row {
  table: 'ingredients' | 'recipes' | 'recipe_ingredients' | 'recipe_steps'
  values: Record<string, unknown>
}

const json = (v: unknown) => (v == null ? null : JSON.stringify(v))

export function ingredientRow(i: ApiIngredient): Row {
  const values: Record<string, unknown> = {}
  for (const [col, key, kind] of INGREDIENT_COLUMNS) {
    const v = i[key]
    if (v === undefined) continue
    values[col] = kind === 'json' ? json(v) : v
  }
  // NOT NULL columns with defaults: leave them to the default when absent.
  for (const col of ['edible_fraction', 'contains_tags', 'calories']) if (values[col] == null) delete values[col]
  return { table: 'ingredients', values }
}

/** The recipe, its ingredients and its steps; the course comes from the listing. */
export function recipeRows(r: ApiRecipeDetail, course: string | null | undefined): Row[] {
  const rows: Row[] = [
    {
      table: 'recipes',
      values: {
        id: r.id,
        name: r.name,
        author_id: null,
        image_url: r.imageUrl ?? null,
        servings: r.servings,
        servings_confidence: r.servingsConfidence ?? 'explicit',
        difficulty: r.difficulty ?? 'medium',
        course: course ?? null,
        meals: r.meals ?? [],
        seasons: r.seasons ?? [],
        meal_fit: json(r.mealFit),
        season_fit: json(r.seasonFit),
        frequency: r.frequency ?? null,
        equipment: r.equipment ?? [],
        allergens: r.allergens ?? [],
        nutrition_per_serving: json(r.nutritionPerServing),
        nutrition_incomplete: r.nutritionIncomplete ?? false,
        tags: r.tags ?? [],
        internal_tags: r.internalTags ?? [],
        prep_time: r.prepTime ?? null,
        cook_time: r.cookTime ?? null,
        active_time: r.activeTime ?? null,
        total_time: r.totalTime ?? null,
        freezable: r.freezable ?? null,
        fridge_days: r.fridgeDays ?? null,
      },
    },
  ]
  for (const [n, ri] of (r.ingredients ?? []).entries()) {
    rows.push({
      table: 'recipe_ingredients',
      values: {
        id: ri.id,
        recipe_id: r.id,
        ingredient_id: ri.ingredientId,
        section: ri.section ?? null,
        quantity: ri.quantity,
        unit: ri.unit,
        optional: ri.optional ?? false,
        note: ri.note ?? null,
        display_order: ri.displayOrder ?? n,
      },
    })
  }
  for (const s of r.steps ?? []) {
    rows.push({
      table: 'recipe_steps',
      values: {
        recipe_id: r.id,
        index: s.index,
        text: s.text,
        duration_min: s.durationMin ?? null,
        temperature: s.temperature ?? null,
        technique: s.technique ?? null,
        ingredient_refs: s.ingredientRefs ?? [],
      },
    })
  }
  return rows
}

/** `postgresql://…/onatest` → `postgresql://…/onatest_catalogo_real` (query kept). */
export function realCatalogDatabaseUrl(suiteUrl: string): string {
  const u = new URL(suiteUrl)
  const name = u.pathname.replace(/^\//, '') || 'postgres'
  u.pathname = `/${name}_catalogo_real`
  return u.toString()
}

/* ── IO ────────────────────────────────────────────────────── */

async function getJson<T>(url: string): Promise<{ body: T; total: number | null }> {
  let last: unknown
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      const total = res.headers.get('x-total-count')
      return { body: (await res.json()) as T, total: total == null ? null : Number(total) }
    } catch (err) {
      last = err
      await new Promise((r) => setTimeout(r, 1_000 * attempt))
    }
  }
  throw new Error(`could not read ${url}: ${String(last)}`)
}

async function fetchAll<T>(source: string, route: string, perPage: number): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; ; page++) {
    const { body, total } = await getJson<T[]>(`${source}${route}?perPage=${perPage}&page=${page}`)
    out.push(...body)
    if (body.length < perPage || (total != null && out.length >= total)) return out
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

async function insert(client: pg.PoolClient, row: Row): Promise<void> {
  const cols = Object.keys(row.values)
  const params = cols.map((_, i) => `$${i + 1}`)
  await client.query(
    `INSERT INTO ${row.table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${params.join(', ')})`,
    cols.map((c) => row.values[c]),
  )
}

async function ensureDatabase(adminUrl: string, targetUrl: string): Promise<void> {
  const name = new URL(targetUrl).pathname.replace(/^\//, '')
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    if (!rowCount) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`)
  } finally {
    await admin.end()
  }
}

async function main(): Promise<void> {
  const target = process.env.DATABASE_URL
  if (!target) throw new Error('DATABASE_URL (the catalogue copy) is required')
  const i = process.argv.indexOf('--source')
  const source = (i > 0 ? process.argv[i + 1] : DEFAULT_SOURCE).replace(/\/+$/, '')

  if (process.env.CREATE_FROM_DATABASE_URL) await ensureDatabase(process.env.CREATE_FROM_DATABASE_URL, target)

  const migrated = spawnSync('pnpm', ['exec', 'tsx', 'src/db/migrate.ts'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: target },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (migrated.status !== 0) throw new Error(`db:migrate failed (${migrated.status})`)

  const pool = new pg.Pool({ connectionString: target })
  try {
    const count = async () => {
      const { rows } = await pool.query<{ r: string; i: string }>(
        "SELECT (SELECT count(*) FROM recipes WHERE author_id IS NULL AND status = 'published') AS r, (SELECT count(*) FROM ingredients) AS i",
      )
      return { recipes: Number(rows[0].r), ingredients: Number(rows[0].i) }
    }
    const before = await count()
    if (before.recipes > 0) {
      console.log(JSON.stringify({ ...before, copied: false }))
      return
    }

    const ingredientList = await fetchAll<ApiIngredient>(source, '/ingredients', 500)
    const listed = (await fetchAll<ApiRecipeListItem>(source, '/recipes', 100)).filter((r) => r.authorId == null)
    const details = await mapLimit(listed, 8, async (r) => (await getJson<ApiRecipeDetail>(`${source}/recipes/${r.id}`)).body)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // A database migrated from scratch may already hold ingredients a
      // backfill created: the source's catalogue wins.
      await client.query('DELETE FROM ingredients WHERE NOT EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.ingredient_id = ingredients.id)')
      for (const ing of ingredientList) {
        await client.query('DELETE FROM ingredients WHERE name = $1', [ing.name])
        await insert(client, ingredientRow(ing))
      }
      for (const [n, d] of details.entries()) {
        for (const row of recipeRows(d, listed[n].course)) await insert(client, row)
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    const after = await count()
    if (after.recipes !== listed.length) throw new Error(`copied ${after.recipes} of ${listed.length} recipes`)
    console.log(JSON.stringify({ ...after, copied: true }))
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[e2e-real-catalog]', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
