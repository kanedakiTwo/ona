/**
 * Smoke (real API + Postgres) for PRO-1125: an ingredient with no nutrition
 * leaves its recipes «incompletas»; giving it values recomputes them all.
 *   - remap (PATCH /ingredients/:id/remap, admin) recomputes the two recipes
 *     that use it;
 *   - the fill command (`applyIngredientNutrition`, what
 *     `scripts/ingredientNutrition.ts --execute` runs) applies a JSON and
 *     recomputes them too.
 *
 * The remap reads the USDA entry from the API's disk cache (written here), so
 * it needs no USDA key: the API and this file share the checkout.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/ingredientNutritionRecompute.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, inArray } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes, users } from '../db/schema.js'
import { applyIngredientNutrition, parseNutritionFile } from '../services/nutrition/ingredientNutritionFill.js'
import { applyNutritionCompleteness } from '../services/nutritionCompleteness.js'

const tag = `pro1125${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const FDC_ID = 990_000_000 + Math.floor(Math.random() * 9_000_000)
const CACHE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'usda', `${FDC_ID}.json`)

const createdRecipes: string[] = []
const createdIngredients: string[] = []

async function stub(name: string): Promise<string> {
  const [row] = await db.insert(ingredients).values({ name: `${name} ${tag}`, calories: 0 }).returning({ id: ingredients.id })
  createdIngredients.push(row.id)
  return row.id
}

/** A recipe with these lines, saved with the stale «0 kcal» a stub gave it. */
async function recipe(name: string, servings: number, lines: Array<{ ingredientId: string; quantity: number }>): Promise<string> {
  const [row] = await db
    .insert(recipes)
    .values({ name: `${name} ${tag}`, servings, meals: ['dinner'], nutritionPerServing: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, saltG: 0 } })
    .returning({ id: recipes.id })
  createdRecipes.push(row.id)
  await db.insert(recipeIngredients).values(lines.map((l, i) => ({ recipeId: row.id, ingredientId: l.ingredientId, quantity: l.quantity, unit: 'g', displayOrder: i })))
  return row.id
}

const read = async (id: string) => (await db.select().from(recipes).where(eq(recipes.id, id)))[0]

async function call(method: string, p: string, token?: string, payload?: unknown) {
  const r = await fetch(`${API_URL}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

afterAll(async () => {
  if (!reachable) return
  if (createdRecipes.length) await db.delete(recipes).where(inArray(recipes.id, createdRecipes))
  if (createdIngredients.length) await db.delete(ingredients).where(inArray(ingredients.id, createdIngredients))
  await fs.rm(CACHE_FILE, { force: true })
})

describe.skipIf(!reachable)('nutrition of an added ingredient (PRO-1125)', () => {
  it('a stub leaves its recipes incomplete; remapping it recomputes the two recipes that use it', async () => {
    const hojaldre = await stub('hojaldre')
    const a = await recipe('Burekas', 4, [{ ingredientId: hojaldre, quantity: 400 }])
    const b = await recipe('Palmeras', 2, [{ ingredientId: hojaldre, quantity: 100 }])

    // The boot mark sees the stub: both recipes are «incompletas».
    await applyNutritionCompleteness(db, () => {})
    expect((await read(a)).nutritionIncomplete).toBe(true)
    expect((await read(b)).nutritionIncomplete).toBe(true)

    const reg = await call('POST', '/register', undefined, { username: tag, email: `${tag}@test.local`, password: 'e2epass123', ageConfirmed: true })
    expect(reg.status, JSON.stringify(reg.body)).toBe(201)
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, reg.body.user.id))

    const per100g = { kcal: 558, proteinG: 7.4, carbsG: 45.7, fatG: 38.5, fiberG: 1.6, saltG: 1.1 }
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true })
    await fs.writeFile(CACHE_FILE, JSON.stringify({ fetchedAt: new Date().toISOString(), profile: { fdcId: FDC_ID, description: 'Puff pastry, frozen, ready-to-bake', per100g, raw: null } }))

    const res = await call('PATCH', `/ingredients/${hojaldre}/remap`, reg.body.token, { fdcId: FDC_ID })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({ fdcId: FDC_ID, calories: 558, recipesRecomputed: 2 })

    const ra = await read(a)
    expect(ra.nutritionIncomplete).toBe(false)
    expect((ra.nutritionPerServing as { kcal: number }).kcal).toBe(558) // 400 g / 4
    const rb = await read(b)
    expect(rb.nutritionIncomplete).toBe(false)
    expect((rb.nutritionPerServing as { kcal: number; fatG: number })).toMatchObject({ kcal: 279, fatG: 19.3 }) // 100 g / 2
  })

  it('the fill command applies a JSON and recomputes the recipes that use it', async () => {
    const manitas = await stub('manitas de cerdo')
    const garbanzos = await stub('garbanzos cocidos')
    const otra = await stub('ingrediente que nadie rellena')
    const guiso = await recipe('Manitas con garbanzos', 2, [
      { ingredientId: manitas, quantity: 500 },
      { ingredientId: garbanzos, quantity: 200 },
    ])
    const sola = await recipe('Manitas solas', 1, [{ ingredientId: manitas, quantity: 100 }])
    const sinTocar = await recipe('Sin rellenar', 1, [{ ingredientId: otra, quantity: 100 }])

    const { entries, errors } = parseNutritionFile({
      [`manitas de cerdo ${tag}`]: { kcal: 232, 'proteína': 23.2, hidratos: 0, grasa: 14.8, fibra: 0, sal: 0.2, fuente: 'BEDCA (cerdo, manitas)' },
      [`Garbanzos Cocidos ${tag}`]: { kcal: 139, proteina: 7.2, hidratos: 20.1, grasa: 2.1, fibra: 6.1, sal: 0.6, fuente: 'USDA SR Legacy 173757' },
      [`no existe ${tag}`]: { kcal: 1, 'proteína': 0, hidratos: 0, grasa: 0, fibra: 0, sal: 0, fuente: 'estimación' },
    })
    expect(errors).toEqual([])

    const dry = await applyIngredientNutrition(db, entries, { execute: false, log: () => {} })
    expect(dry.filled).toHaveLength(2)
    expect(dry.recipes).toEqual([])
    expect((await read(guiso)).nutritionPerServing).toMatchObject({ kcal: 0 })

    const lines: string[] = []
    const res = await applyIngredientNutrition(db, entries, { execute: true, log: (l) => lines.push(l) })
    expect(res.filled.map((f) => f.name).sort()).toEqual([`garbanzos cocidos ${tag}`, `manitas de cerdo ${tag}`])
    expect(res.unknown).toEqual([`no existe ${tag}`])
    expect(res.recipes.map((r) => r.id).sort()).toEqual([guiso, sola].sort())

    const [g] = await db.select().from(ingredients).where(eq(ingredients.id, garbanzos))
    expect(g).toMatchObject({ fdcId: 173757, calories: 139 })
    const [m] = await db.select().from(ingredients).where(eq(ingredients.id, manitas))
    expect(m).toMatchObject({ fdcId: null, calories: 232 })

    const rg = await read(guiso)
    expect(rg.nutritionIncomplete).toBe(false)
    expect(rg.nutritionPerServing).toMatchObject({ kcal: Math.round((232 * 5 + 139 * 2) / 2) })
    expect((await read(sola)).nutritionPerServing).toMatchObject({ kcal: 232 })
    expect(lines.some((l) => l.includes(`Manitas solas ${tag}`) && l.includes('0 → 232 kcal'))).toBe(true)

    // A recipe whose ingredient the file doesn't fill is not touched.
    expect((await read(sinTocar)).nutritionPerServing).toMatchObject({ kcal: 0 })

    // Second run: the rows have nutrition now, nothing changes.
    const again = await applyIngredientNutrition(db, entries, { execute: true, log: () => {} })
    expect(again.filled).toEqual([])
    expect(again.kept).toHaveLength(2)
  })
})
