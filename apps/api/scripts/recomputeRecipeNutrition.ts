#!/usr/bin/env tsx
/**
 * Recompute `recipes.nutrition_per_serving` and `recipes.allergens` for
 * every system recipe (or a `--scope=all` set), using the live
 * `ingredients` + `recipe_ingredients` data.
 *
 * Useful after `seed:usda` enriches ingredient nutrition: the cached
 * `nutritionPerServing` on each recipe is now stale and needs a refresh.
 *
 * Usage:
 *   DATABASE_URL=<db> tsx scripts/recomputeRecipeNutrition.ts            # dry-run, system recipes only
 *   DATABASE_URL=<db> tsx scripts/recomputeRecipeNutrition.ts --execute  # commit
 *   DATABASE_URL=<db> tsx scripts/recomputeRecipeNutrition.ts --scope=all --execute  # include user recipes
 */
import { db, pool } from '../src/db/connection.js'
import {
  recipes,
  recipeIngredients,
  ingredients as ingredientsTable,
} from '../src/db/schema.js'
import { aggregateNutrition } from '../src/services/nutrition/aggregate.js'
import { allergenUnion } from '../src/services/nutrition/allergens.js'
import { eq, isNull, inArray } from 'drizzle-orm'

const EXECUTE = process.argv.includes('--execute')
const SCOPE_ALL = process.argv.includes('--scope=all')

async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}  Scope: ${SCOPE_ALL ? 'all' : 'system-only'}`)

  // Build the ingredient catalog (nutrition + allergens).
  const ingRows = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      allergenTags: ingredientsTable.allergenTags,
      density: ingredientsTable.density,
      unitWeight: ingredientsTable.unitWeight,
      calories: ingredientsTable.calories,
      protein: ingredientsTable.protein,
      carbs: ingredientsTable.carbs,
      fat: ingredientsTable.fat,
      fiber: ingredientsTable.fiber,
      salt: ingredientsTable.salt,
    })
    .from(ingredientsTable)

  const nutritionCatalog = new Map<string, any>()
  const allergenCatalog = new Map<string, { allergenTags?: string[] | null }>()
  for (const r of ingRows) {
    nutritionCatalog.set(r.id, {
      id: r.id,
      name: r.name,
      calories: r.calories ?? 0,
      protein: r.protein ?? 0,
      carbs: r.carbs ?? 0,
      fat: r.fat ?? 0,
      fiber: r.fiber ?? 0,
      salt: r.salt ?? 0,
      density: r.density,
      unitWeight: r.unitWeight,
    })
    allergenCatalog.set(r.id, { allergenTags: r.allergenTags ?? [] })
  }

  // Load target recipes.
  const recipeRows = SCOPE_ALL
    ? await db.select({ id: recipes.id, name: recipes.name, servings: recipes.servings }).from(recipes)
    : await db
        .select({ id: recipes.id, name: recipes.name, servings: recipes.servings })
        .from(recipes)
        .where(isNull(recipes.authorId))

  console.log(`Recipes to recompute: ${recipeRows.length}`)

  // Pull all recipe_ingredients in one shot.
  const recipeIds = recipeRows.map((r) => r.id)
  const ingsByRecipe = new Map<string, any[]>()
  if (recipeIds.length > 0) {
    const ingsAll = await db
      .select({
        id: recipeIngredients.id,
        recipeId: recipeIngredients.recipeId,
        ingredientId: recipeIngredients.ingredientId,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .where(inArray(recipeIngredients.recipeId, recipeIds))
    for (const r of ingsAll) {
      const list = ingsByRecipe.get(r.recipeId) ?? []
      list.push(r)
      ingsByRecipe.set(r.recipeId, list)
    }
  }

  let updated = 0
  let zero = 0
  for (const r of recipeRows) {
    const ings = ingsByRecipe.get(r.id) ?? []
    if (ings.length === 0) {
      console.log(`  [skip] ${r.name} — no ingredients`)
      continue
    }
    const agg = aggregateNutrition({
      servings: r.servings ?? 2,
      ingredients: ings.map((ing) => ({
        id: ing.id,
        ingredientId: ing.ingredientId,
        quantity: ing.quantity,
        unit: ing.unit as any,
      })),
      catalog: nutritionCatalog,
    })
    const allergens = allergenUnion(
      ings.map((ing) => ({ ingredientId: ing.ingredientId })),
      allergenCatalog,
    )

    if (agg.perServing.kcal === 0) zero++

    if (EXECUTE) {
      await db
        .update(recipes)
        .set({
          nutritionPerServing: agg.perServing,
          allergens,
          updatedAt: new Date(),
        })
        .where(eq(recipes.id, r.id))
    }
    updated++
    console.log(
      `  ${EXECUTE ? '[ok]' : '[dry]'} ${r.name.padEnd(40)} kcal=${agg.perServing.kcal} allergens=[${allergens.join(', ')}]${agg.skipped.length > 0 ? `  (${agg.skipped.length} ing skipped)` : ''}`,
    )
  }

  console.log(`\n${EXECUTE ? 'Updated' : 'Would update'} ${updated} recipe(s). ${zero} with kcal=0.`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  pool.end()
  process.exit(1)
})
