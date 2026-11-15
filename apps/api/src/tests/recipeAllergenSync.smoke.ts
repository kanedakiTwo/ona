/**
 * Smoke (real Postgres) for PRO-1118: an ingredient gets «sesamo» and the two
 * recipes that use it carry it, without touching their ingredients or steps;
 * the read-only count sees them before and not after.
 *
 * Needs Postgres (DATABASE_URL) and a running API (API_URL, for `reachable`),
 * like the CI smoke job; skips otherwise.
 */
import { describe, expect, it } from 'vitest'
import { asc, eq, inArray } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients, recipeSteps, recipes } from '../db/schema.js'
import {
  findRecipeAllergenMismatches,
  recomputeRecipeAllergens,
} from '../services/nutrition/recipeAllergenSync.js'

const tag = `ras${Date.now()}${Math.random().toString(36).slice(2, 6)}`

describe.skipIf(!reachable)("recipes follow their ingredients' allergens (PRO-1118)", () => {
  it("za'atar gets sesame → both recipes using it carry it", async () => {
    const [zaatar] = await db.insert(ingredients).values({ name: `Za'atar ${tag}`, allergenTags: [] }).returning({ id: ingredients.id })
    const [feta] = await db.insert(ingredients).values({ name: `Feta ${tag}`, allergenTags: ['lactosa'] }).returning({ id: ingredients.id })
    const [ensalada] = await db
      .insert(recipes)
      .values({ name: `Ensalada de perejil ${tag}`, servings: 2, meals: ['lunch'], allergens: ['lactosa'] })
      .returning({ id: recipes.id })
    const [crema] = await db
      .insert(recipes)
      .values({ name: `Crema con za'atar ${tag}`, servings: 2, meals: ['dinner'], allergens: [] })
      .returning({ id: recipes.id })
    const [otra] = await db
      .insert(recipes)
      .values({ name: `Otra ${tag}`, servings: 2, meals: ['dinner'], allergens: ['lactosa'] })
      .returning({ id: recipes.id })
    await db.insert(recipeIngredients).values([
      { recipeId: ensalada.id, ingredientId: feta.id, quantity: 100, unit: 'g' },
      { recipeId: ensalada.id, ingredientId: zaatar.id, quantity: 5, unit: 'g' },
      { recipeId: crema.id, ingredientId: zaatar.id, quantity: 5, unit: 'g' },
      { recipeId: otra.id, ingredientId: feta.id, quantity: 50, unit: 'g' },
    ] as any)
    await db.insert(recipeSteps).values([
      { recipeId: ensalada.id, index: 0, text: 'Mezcla el perejil con la feta.' },
      { recipeId: crema.id, index: 0, text: "Espolvorea el za'atar." },
    ])
    const ids = [ensalada.id, crema.id, otra.id]
    const snapshot = async () => ({
      lines: await db
        .select({ recipeId: recipeIngredients.recipeId, ingredientId: recipeIngredients.ingredientId, quantity: recipeIngredients.quantity })
        .from(recipeIngredients)
        .where(inArray(recipeIngredients.recipeId, ids))
        .orderBy(asc(recipeIngredients.recipeId), asc(recipeIngredients.ingredientId)),
      steps: await db
        .select({ recipeId: recipeSteps.recipeId, index: recipeSteps.index, text: recipeSteps.text })
        .from(recipeSteps)
        .where(inArray(recipeSteps.recipeId, ids))
        .orderBy(asc(recipeSteps.recipeId), asc(recipeSteps.index)),
    })
    const allergensOf = async (id: string) =>
      (await db.select({ allergens: recipes.allergens }).from(recipes).where(eq(recipes.id, id)))[0].allergens

    try {
      // Nothing to do while the tags match.
      expect(await db.transaction((tx) => recomputeRecipeAllergens(tx, zaatar.id))).toEqual([])
      const before = await snapshot()

      // Cocina marks sesame on the za'atar row: the count sees both recipes…
      await db.update(ingredients).set({ allergenTags: ['sesamo'] }).where(eq(ingredients.id, zaatar.id))
      const found = (await findRecipeAllergenMismatches(db)).map((r) => r.id)
      expect(found).toEqual(expect.arrayContaining([ensalada.id, crema.id]))
      expect(found).not.toContain(otra.id)

      // …and the recompute fixes them.
      const changes = await db.transaction((tx) => recomputeRecipeAllergens(tx, zaatar.id))
      expect(changes.map((c) => [c.recipeId, c.before, c.after]).sort()).toEqual(
        [
          [ensalada.id, ['lactosa'], ['lactosa', 'sesamo']],
          [crema.id, [], ['sesamo']],
        ].sort(),
      )
      expect(await allergensOf(ensalada.id)).toEqual(['lactosa', 'sesamo'])
      expect(await allergensOf(crema.id)).toEqual(['sesamo'])
      expect(await allergensOf(otra.id)).toEqual(['lactosa'])
      expect(await snapshot()).toEqual(before)

      const after = (await findRecipeAllergenMismatches(db)).map((r) => r.id)
      expect(after).not.toContain(ensalada.id)
      expect(after).not.toContain(crema.id)
      // Idempotent.
      expect(await db.transaction((tx) => recomputeRecipeAllergens(tx, zaatar.id))).toEqual([])
    } finally {
      await db.delete(recipes).where(inArray(recipes.id, ids))
      await db.delete(ingredients).where(inArray(ingredients.id, [zaatar.id, feta.id]))
    }
  })
})
