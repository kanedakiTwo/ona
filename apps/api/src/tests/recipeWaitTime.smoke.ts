/**
 * Smoke (Postgres) for PRO-402: the catalogue import saves a recipe with a
 * 12 h soak without counting it as cooking — the cook time and the total
 * leave it out, and it becomes a «preparativo con antelación» (la víspera).
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/recipeWaitTime.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { eq, ilike, inArray } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { ingredients, recipes } from '../db/schema.js'
import { persistCatalogDraft } from '../services/catalogImportDb.js'

const tag = `remojo${Date.now().toString(36)}`
const created: string[] = []

afterAll(async () => {
  if (!reachable || !created.length) return
  await db.delete(recipes).where(inArray(recipes.id, created))
})

describe.skipIf(!reachable)('PRO-402: the soak is not cooking time at the import', () => {
  it('a 12 h soak stays out of the cook time and the total, and goes to «la víspera»', async () => {
    const [garbanzo] = await db.select({ id: ingredients.id }).from(ingredients).where(ilike(ingredients.name, 'garbanzo%')).limit(1)
    expect(garbanzo).toBeTruthy()
    const res = await persistCatalogDraft({
      name: `Garbanzos aliñados ${tag}`,
      servings: 4,
      prepTime: 15,
      cookTime: 780,
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
      ingredients: [{ ingredientId: garbanzo.id, quantity: 300, unit: 'g' }],
      steps: [
        { index: 0, text: 'Ponemos los garbanzos en remojo con agua fría. Al día siguiente los escurrimos.', durationMin: 720, temperature: null, technique: null, ingredientRefs: ['ing_0'] },
        { index: 1, text: 'Cocemos los garbanzos en agua con sal hasta que estén tiernos.', durationMin: 50, temperature: null, technique: 'hervir', ingredientRefs: ['ing_0'] },
        { index: 2, text: 'Escurrimos los garbanzos y los aliñamos con aceite y sal.', durationMin: 10, temperature: null, technique: null, ingredientRefs: ['ing_0'] },
      ],
      catalogSource: { origin: 'cocina', batch: tag, auditIssues: [], allergenDoubt: false },
    })
    expect(res.ok ? [] : res.errors).toEqual([])
    if (!res.ok) return
    created.push(res.recipeId)

    const [row] = await db
      .select({ prepTime: recipes.prepTime, cookTime: recipes.cookTime, totalTime: recipes.totalTime, advancePrep: recipes.advancePrep })
      .from(recipes)
      .where(eq(recipes.id, res.recipeId))
    expect(row.cookTime).toBe(60)
    expect(row.totalTime).toBeLessThanOrEqual(75)
    expect(row.totalTime).toBeGreaterThanOrEqual(60)
    expect(row.advancePrep).toEqual([{ text: 'Ponemos los garbanzos en remojo con agua fría', hoursBefore: 14 }])
  })
})
