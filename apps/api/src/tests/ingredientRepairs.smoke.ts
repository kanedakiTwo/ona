/**
 * Smoke (Postgres) for PRO-1047's boot step: an ingredient that still holds
 * a wrong USDA entry («Dulce de Leche») gets its values, one with no repair
 * is left with none, and their recipes are recomputed; a recipe «incompleta»
 * by «4 u, lomos de unos 150 g» of an ingredient with no unit weight gets
 * its figures.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/ingredientRepairs.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes } from '../db/schema.js'
import { applyIngredientRepairs } from '../services/nutrition/ingredientRepairs.js'
import type { NutritionPerServing } from '@ona/shared'

const tag = `pro1047${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const DULCE_DE_LECHE = { fdcId: 173461, calories: 315, protein: 6.84, carbs: 55.35, fat: 7.35, fiber: 0, salt: 0.3225 }
const STALE: NutritionPerServing = { kcal: 999, proteinG: 1, carbsG: 99, fatG: 9, fiberG: 0, saltG: 0 }

const createdRecipes: string[] = []
const createdIngredients: string[] = []

async function ingredient(name: string, values: Partial<typeof DULCE_DE_LECHE> & { unitWeight?: number | null }): Promise<string> {
  const [row] = await db.insert(ingredients).values({ name, calories: 0, ...values }).returning({ id: ingredients.id })
  createdIngredients.push(row.id)
  return row.id
}

async function recipe(name: string, servings: number, incomplete: boolean, lines: Array<{ ingredientId: string; quantity: number; unit: string; note?: string }>): Promise<string> {
  const [row] = await db
    .insert(recipes)
    .values({ name: `${name} ${tag}`, servings, meals: ['dinner'], nutritionPerServing: STALE, nutritionIncomplete: incomplete })
    .returning({ id: recipes.id })
  createdRecipes.push(row.id)
  await db.insert(recipeIngredients).values(lines.map((l, i) => ({ recipeId: row.id, displayOrder: i, note: l.note ?? null, ...l })))
  return row.id
}

const read = async (id: string) => (await db.select().from(recipes).where(eq(recipes.id, id)))[0]
const readIngredient = async (id: string) => (await db.select().from(ingredients).where(eq(ingredients.id, id)))[0]

afterAll(async () => {
  if (!reachable) return
  if (createdRecipes.length) await db.delete(recipes).where(inArray(recipes.id, createdRecipes))
  if (createdIngredients.length) await db.delete(ingredients).where(inArray(ingredients.id, createdIngredients))
})

describe.skipIf(!reachable)('ingredients with a wrong USDA entry, fixed at boot (PRO-1047)', () => {
  it('repairs them, recomputes their recipes, and weighs «4 u, lomos de unos 150 g»', async () => {
    const [existing] = await db.select({ id: ingredients.id }).from(ingredients).where(eq(ingredients.name, 'corazones de pollo'))
    const corazones = existing?.id ?? (await ingredient('corazones de pollo', DULCE_DE_LECHE))
    if (existing) await db.update(ingredients).set(DULCE_DE_LECHE).where(eq(ingredients.id, corazones))
    const unknown = await ingredient(`mermelada rara ${tag}`, DULCE_DE_LECHE)
    const salmon = await ingredient(`salmón ${tag}`, { fdcId: 175167, calories: 208, protein: 20.42, carbs: 0, fat: 13.42, unitWeight: null })

    const guiso = await recipe('Corazones guisados', 2, false, [{ ingredientId: corazones, quantity: 200, unit: 'g' }])
    const tostada = await recipe('Tostada con mermelada', 1, false, [{ ingredientId: unknown, quantity: 30, unit: 'g' }])
    const papillote = await recipe('Salmón en papillote', 4, true, [{ ingredientId: salmon, quantity: 4, unit: 'u', note: 'lomos de unos 150 g' }])

    await applyIngredientRepairs(db, () => {})

    // The estimate of «Chicken, heart, raw».
    expect(await readIngredient(corazones)).toMatchObject({ fdcId: null, calories: 153 })
    expect((await read(guiso)).nutritionPerServing).toMatchObject({ kcal: 153, proteinG: 15.6 })

    // No repair for it: no nutrition, and the recipe says «incompleta» instead of 315 kcal per 100 g.
    expect(await readIngredient(unknown)).toMatchObject({ fdcId: null, calories: 0, protein: 0, carbs: 0 })
    expect((await read(tostada)).nutritionIncomplete).toBe(true)

    // 600 g of salmon for 4.
    const p = await read(papillote)
    expect(p.nutritionIncomplete).toBe(false)
    expect(p.nutritionPerServing).toMatchObject({ kcal: 312, proteinG: 30.6 })

    // Idempotent: a second boot leaves the fixed rows alone.
    await db.update(ingredients).set({ calories: 160 }).where(eq(ingredients.id, corazones))
    await applyIngredientRepairs(db, () => {})
    expect((await readIngredient(corazones)).calories).toBe(160)
  })
})
