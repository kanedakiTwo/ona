/**
 * Smoke (real Postgres) for PRO-1062: the boot step gives `sesamo` to a
 * sesame ingredient that lacks it and to every recipe that uses a sesame
 * ingredient (even one already tagged), logs the recipes by name, never
 * removes a tag, and a second run changes nothing of ours.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/sesameOilAllergen.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes } from '../db/schema.js'
import { applyNameAllergenTags } from '../services/nutrition/allergenBackfill.js'

const tag = `pro1062${Date.now().toString(36)}`
const recipeIds: string[] = []
const ingredientIds: string[] = []

async function ingredient(name: string, allergenTags: string[]): Promise<string> {
  const [row] = await db.insert(ingredients).values({ name: `${name} ${tag}`, allergenTags }).returning({ id: ingredients.id })
  ingredientIds.push(row.id)
  return row.id
}

async function recipe(name: string, allergens: string[], ings: string[]): Promise<string> {
  const [row] = await db
    .insert(recipes)
    .values({ name: `${name} ${tag}`, authorId: null, servings: 2, meals: ['dinner'], allergens })
    .returning({ id: recipes.id })
  await db.insert(recipeIngredients).values(ings.map((ingredientId, i) => ({ recipeId: row.id, ingredientId, quantity: 10, displayOrder: i })))
  recipeIds.push(row.id)
  return row.id
}

const allergensOf = async (id: string) => (await db.select({ a: recipes.allergens }).from(recipes).where(eq(recipes.id, id)))[0].a
const tagsOf = async (id: string) =>
  (await db.select({ t: ingredients.allergenTags }).from(ingredients).where(eq(ingredients.id, id)))[0].t

afterAll(async () => {
  if (!reachable) return
  if (recipeIds.length) await db.delete(recipes).where(inArray(recipes.id, recipeIds))
  if (ingredientIds.length) await db.delete(ingredients).where(inArray(ingredients.id, ingredientIds))
})

describe.skipIf(!reachable)('sesame boot step (PRO-1062)', () => {
  it('tags the ingredient and the recipes, logs them, idempotent', async () => {
    const untagged = await ingredient('Aceite de sésamo', [])
    const tagged = await ingredient('Semillas de sésamo', ['sesamo'])
    const noodles = await ingredient('Fideos de arroz', [])
    const oil = await ingredient('Aceite de oliva', [])

    const r1 = await recipe('Noodles con aceite de sésamo', ['soja'], [noodles, untagged])
    const r2 = await recipe('Ensalada con semillas', [], [tagged, oil])
    const r3 = await recipe('Fideos sin sésamo', [], [noodles, oil])

    const lines: string[] = []
    const res = await applyNameAllergenTags(db, (l) => lines.push(l))

    expect(await tagsOf(untagged)).toEqual(['sesamo'])
    expect(await tagsOf(tagged)).toEqual(['sesamo'])
    expect(await allergensOf(r1)).toEqual(['sesamo', 'soja'])
    expect(await allergensOf(r2)).toEqual(['sesamo'])
    expect(await allergensOf(r3)).toEqual([])
    expect(res.ingredients).toContain(`«Aceite de sésamo ${tag}» +sesamo`)
    expect(res.recipeNames).toContain(`«Noodles con aceite de sésamo ${tag}» +sesamo (catálogo)`)
    expect(res.recipeNames).toContain(`«Ensalada con semillas ${tag}» +sesamo (catálogo)`)
    expect(lines.join('\n')).toContain(`Noodles con aceite de sésamo ${tag}`)

    const again = await applyNameAllergenTags(db, () => {})
    expect(again.ingredients.filter((l) => l.includes(tag))).toEqual([])
    expect(again.recipeNames.filter((l) => l.includes(tag))).toEqual([])
    expect(await allergensOf(r1)).toEqual(['sesamo', 'soja'])
  })
})
