/**
 * Smoke (real API + Postgres) for PRO-154 (specs/catalog-import.md):
 *   - a catalogue `draft` is not in GET /recipes, doesn't open for anyone but
 *     an admin, and the menu never picks it (loadMatchableRecipes, the same
 *     loader the generator and Mimo's swaps use);
 *   - publishing it makes it appear, and closes the wish it covers;
 *   - a request with no recipe creates or adds to a «deseo del catálogo»,
 *     readable with the metrics token without personal data.
 *
 *   API_URL=… DATABASE_URL=… METRICS_READ_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/catalogImport.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { asc, eq, inArray, isNull, and } from 'drizzle-orm'
import { API_URL, reachable, TOKEN, USER_ID } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { catalogWishes, recipeIngredients, recipes, recipeSteps } from '../db/schema.js'
import { loadMatchableRecipes } from '../services/matchableRecipes.js'
import { publishRecipes } from '../services/catalogImportDb.js'
import { recordCatalogWish } from '../services/catalogWishes.js'

const tag = `pro154${Date.now().toString(36)}`
const DRAFT_NAME = `Guiso de prueba ${tag}`
const METRICS_TOKEN = process.env.METRICS_READ_TOKEN ?? ''
const created: string[] = []
const wishIds: string[] = []

async function call(method: string, path: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, { method, headers })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

/** A draft copy of a published catalogue recipe (with its ingredients and steps). */
async function insertDraft(): Promise<string> {
  const [src] = await db.select().from(recipes).where(and(isNull(recipes.authorId), eq(recipes.status, 'published'))).orderBy(asc(recipes.name)).limit(1)
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src
  const [row] = await db
    .insert(recipes)
    .values({ ...rest, name: DRAFT_NAME, imageUrl: '/images/recipes/placeholder.jpg', status: 'draft', importBatch: tag, catalogSource: { origin: 'cocina', book: 'Libro inventado', page: '7', batch: tag, auditIssues: [], allergenDoubt: false } })
    .returning({ id: recipes.id })
  const ings = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, src.id))
  if (ings.length) await db.insert(recipeIngredients).values(ings.map(({ id: _i, ...i }) => ({ ...i, recipeId: row.id })))
  const steps = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, src.id))
  if (steps.length) await db.insert(recipeSteps).values(steps.map(({ id: _i, ...s }) => ({ ...s, recipeId: row.id, ingredientRefs: [] })))
  created.push(row.id)
  return row.id
}

afterAll(async () => {
  if (!reachable) return
  if (created.length) await db.delete(recipes).where(inArray(recipes.id, created))
  if (wishIds.length) await db.delete(catalogWishes).where(inArray(catalogWishes.id, wishIds))
})

describe.skipIf(!reachable)('catalogue drafts and wishes (PRO-154)', () => {
  it('a draft is invisible (listing, detail, menu) until it is published', async () => {
    const id = await insertDraft()

    const list = await call('GET', `/recipes?search=${encodeURIComponent(tag)}`, { Authorization: `Bearer ${TOKEN}` })
    expect(list.status).toBe(200)
    expect(list.body.map((r: { id: string }) => r.id)).not.toContain(id)
    expect((await call('GET', `/recipes/${id}`)).status).toBe(404)
    expect((await call('GET', `/recipes/${id}`, { Authorization: `Bearer ${TOKEN}` })).status).toBe(404)

    const matchable = await loadMatchableRecipes(USER_ID)
    expect(matchable.length).toBeGreaterThan(0)
    expect(matchable.map((r) => r.id)).not.toContain(id)

    // Someone wanted this dish before we had it.
    const wish = await recordCatalogWish({ dish: DRAFT_NAME, source: 'evaluador', userId: USER_ID })
    expect(wish?.households).toBe(1)
    wishIds.push(wish!.wishId)

    const res = await publishRecipes([id])
    expect(res).toEqual({ published: 1, wishesCovered: 1 })
    const after = await call('GET', `/recipes?search=${encodeURIComponent(tag)}`)
    expect(after.body.map((r: { id: string }) => r.id)).toContain(id)
    expect((await call('GET', `/recipes/${id}`)).status).toBe(200)
    expect((await loadMatchableRecipes(USER_ID)).map((r) => r.id)).toContain(id)
    const [w] = await db.select().from(catalogWishes).where(eq(catalogWishes.id, wish!.wishId))
    expect(w).toMatchObject({ status: 'cubierto', recipeId: id })
  }, 30_000)

  it.skipIf(!METRICS_TOKEN)('a wish adds households and reads without personal data', async () => {
    const dish = `Rodaballo de prueba ${tag}`
    const a = await recordCatalogWish({ dish, source: 'alta', userId: USER_ID })
    wishIds.push(a!.wishId)
    const again = await recordCatalogWish({ dish: dish.toUpperCase(), source: 'alta', userId: USER_ID })
    expect(again).toMatchObject({ wishId: a!.wishId, created: false, households: 1 })

    expect((await call('GET', '/admin/catalog-wishes')).status).toBe(401)
    const r = await call('GET', '/admin/catalog-wishes?limit=1000', { 'x-metrics-token': METRICS_TOKEN })
    expect(r.status).toBe(200)
    const item = r.body.items.find((i: { id: string }) => i.id === a!.wishId)
    expect(item).toMatchObject({ dish, households: 1, sources: ['alta'], status: 'abierto' })
    expect(JSON.stringify(r.body)).not.toContain(USER_ID)
  }, 30_000)
})
