/**
 * Smoke (real API + Postgres) for «la receta del día» (PRO-1099,
 * specs/recipe-of-the-day.md):
 *   - one recipe per day at the database (`uq_recipes_featured_on`, migration 0106);
 *   - the import refuses a day already taken, in words, and saves nothing;
 *   - only published catalogue recipes count: a draft's day is skipped and
 *     the one before shows, with its own date («hoy no hay»);
 *   - the real routes, without an account: the view, 404 for a day with no
 *     photo, 400 for a date that isn't a day.
 * Dates in 2099 so nothing real is touched.
 *
 *   API_URL=… DATABASE_URL=… SMOKE_USER_TOKEN=… SMOKE_USER_ID=… pnpm --filter @ona/api exec vitest run src/tests/recipeOfTheDay.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { recipeIngredients, recipes } from '../db/schema.js'
import { featuredOnTaken, persistCatalogDraft } from '../services/catalogImportDb.js'
import { createDbRecipeOfTheDayDeps, loadRecipeOfTheDay } from '../services/recipeOfTheDay.js'

const tag = `deldia${Date.now().toString(36)}`
const created: string[] = []

/** A copy of a published catalogue recipe (with its ingredients), for `featuredOn`. */
async function insertFeatured(name: string, featuredOn: string, status: 'published' | 'draft' = 'published'): Promise<string> {
  const [src] = await db.select().from(recipes).where(and(isNull(recipes.authorId), eq(recipes.status, 'published'))).orderBy(asc(recipes.name)).limit(1)
  const { id: _id, createdAt: _c, updatedAt: _u, featuredOn: _f, ...rest } = src
  const [row] = await db
    .insert(recipes)
    .values({ ...rest, name, status, featuredOn, importBatch: tag, imageUrl: null, catalogSource: { origin: 'cocina', batch: tag, auditIssues: [], allergenDoubt: false, credit: 'Receta de prueba inventada' } })
    .returning({ id: recipes.id })
  const ings = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, src.id))
  if (ings.length) await db.insert(recipeIngredients).values(ings.map(({ id: _i, ...i }) => ({ ...i, recipeId: row.id })))
  created.push(row.id)
  return row.id
}

afterAll(async () => {
  if (!reachable || !created.length) return
  await db.delete(recipes).where(inArray(recipes.id, created))
})

describe.skipIf(!reachable)('la receta del día against Postgres', () => {
  it('one recipe per day at the database; the import says which day is taken', async () => {
    await insertFeatured(`Guiso del día ${tag}`, '2099-01-10')
    await expect(insertFeatured(`Otro guiso ${tag}`, '2099-01-10')).rejects.toThrow()

    const res = await persistCatalogDraft({
      name: `Borrador del día ${tag}`,
      servings: 4,
      prepTime: 10,
      cookTime: 20,
      difficulty: 'easy',
      meals: ['lunch'],
      seasons: ['autumn'],
      course: null,
      equipment: [],
      tags: [],
      internalTags: [],
      tips: null,
      freezable: null,
      fridgeDays: null,
      featuredOn: '2099-01-10',
      ingredients: [],
      steps: [],
      catalogSource: { origin: 'cocina', batch: tag, auditIssues: [], allergenDoubt: false },
    })
    expect(res).toEqual({ ok: false, errors: [featuredOnTaken('2099-01-10', `Guiso del día ${tag}`)] })
    expect(await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.name, `Borrador del día ${tag}`))).toHaveLength(0)
  })

  it('only published recipes; a day without one shows the last before it, with its date', async () => {
    const pub = await insertFeatured(`Crema del día ${tag}`, '2099-02-01')
    await insertFeatured(`Borrador oculto ${tag}`, '2099-02-03', 'draft')
    const deps = createDbRecipeOfTheDayDeps('https://mimoia.com')

    const exact = await loadRecipeOfTheDay('2099-02-01', deps)
    expect(exact).toMatchObject({ recipeId: pub, date: '2099-02-01', isRequestedDate: true, credit: 'Receta de prueba inventada', photos: null })
    expect(exact!.keyIngredients.length).toBeGreaterThan(0)
    // The 3rd only has a draft: it doesn't count.
    expect(await loadRecipeOfTheDay('2099-02-04', deps)).toMatchObject({ recipeId: pub, date: '2099-02-01', requestedDate: '2099-02-04', isRequestedDate: false })
  })

  it('the real routes, without an account', async () => {
    const r = await fetch(`${API_URL}/recipe-of-the-day/2099-02-02`)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ title: `Crema del día ${tag}`, date: '2099-02-01', isRequestedDate: false })
    expect((await fetch(`${API_URL}/recipe-of-the-day/2099-02-01/photo/vertical`)).status).toBe(404)
    expect((await fetch(`${API_URL}/recipe-of-the-day/2099-02-31`)).status).toBe(400)
  })
})
