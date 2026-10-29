/**
 * Smoke (real API + Postgres) for «Este mes» (PRO-375, specs/recipes.md):
 * `GET /recipes?ingredient=calabaza` only brings recipes with calabaza (not
 * calabacín), and `GET /recipes/seasonal-produce` counts the month's products.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/seasonalProduce.smoke.ts
 *
 * Skips when the API isn't reachable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes } from '../db/schema.js'

const tag = `temp${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const recipeIds: string[] = []
const ingredientIds: string[] = []

async function get(path: string) {
  const r = await fetch(`${API_URL}${path}`)
  return { status: r.status, body: await r.json() }
}

async function recipeWith(name: string, ingredientId: string, status = 'published') {
  const [rec] = await db.insert(recipes).values({ name: `${name} ${tag}`, servings: 2, status } as any).returning({ id: recipes.id })
  recipeIds.push(rec.id)
  await db.insert(recipeIngredients).values({ recipeId: rec.id, ingredientId, quantity: 300, unit: 'g' } as any)
  return rec.id
}

let calabaza: string[] = []
let draft = ''
let calabacin = ''

beforeAll(async () => {
  if (!reachable) return
  const ing = await db
    .insert(ingredients)
    .values([{ name: `Calabaza ${tag}` }, { name: `Calabacín ${tag}` }])
    .returning({ id: ingredients.id, name: ingredients.name })
  ingredientIds.push(...ing.map((i) => i.id))
  const [squash, zucchini] = ing
  calabaza = [
    await recipeWith('Crema de calabaza', squash.id),
    await recipeWith('Calabaza asada', squash.id),
    await recipeWith('Risotto de calabaza', squash.id),
  ]
  draft = await recipeWith('Borrador de calabaza', squash.id, 'draft')
  calabacin = await recipeWith('Calabacín relleno', zucchini.id)
})

afterAll(async () => {
  if (!reachable) return
  if (recipeIds.length) await db.delete(recipes).where(inArray(recipes.id, recipeIds))
  if (ingredientIds.length) await db.delete(ingredients).where(inArray(ingredients.id, ingredientIds))
})

describe.skipIf(!reachable)('«Este mes» (PRO-375)', () => {
  it('GET /recipes?ingredient=calabaza only brings published recipes with calabaza', async () => {
    const res = await get('/recipes?ingredient=calabaza&perPage=100')
    expect(res.status).toBe(200)
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id)
    for (const id of calabaza) expect(ids).toContain(id)
    expect(ids).not.toContain(calabacin)
    expect(ids).not.toContain(draft)
    // Every card it brings has calabaza among its ingredients.
    const rows = await db
      .select({ recipeId: recipeIngredients.recipeId, name: ingredients.name })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(inArray(recipeIngredients.recipeId, ids))
    for (const id of ids) {
      expect(rows.some((r) => r.recipeId === id && /calabaza/i.test(r.name))).toBe(true)
    }
  })

  it('accepts accents and plurals; an unknown ingredient brings nothing', async () => {
    const plural = await get('/recipes?ingredient=Calabazas&perPage=100')
    expect((plural.body as Array<{ id: string }>).map((r) => r.id)).toEqual(expect.arrayContaining(calabaza))
    const none = await get(`/recipes?ingredient=${encodeURIComponent(`nada-${tag}`)}`)
    expect(none.status).toBe(200)
    expect(none.body).toEqual([])
  })

  it('GET /recipes/seasonal-produce counts calabaza in October and not in July', async () => {
    const oct = await get('/recipes/seasonal-produce?month=10')
    expect(oct.status).toBe(200)
    const squash = (oct.body as Array<{ name: string; emoji: string; recipeCount: number }>).find((p) => p.name === 'Calabaza')
    expect(squash).toMatchObject({ emoji: '🎃' })
    // Ours (3 published; the draft doesn't count) plus whatever the catalogue has.
    expect(squash!.recipeCount).toBeGreaterThanOrEqual(3)
    for (const p of oct.body) expect(p.recipeCount).toBeGreaterThanOrEqual(3)
    const jul = await get('/recipes/seasonal-produce?month=7')
    expect((jul.body as Array<{ name: string }>).map((p) => p.name)).not.toContain('Calabaza')
  })
})
