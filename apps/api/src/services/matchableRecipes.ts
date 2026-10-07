import { eq, inArray } from 'drizzle-orm'
import type { Course } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { recipes, recipeIngredients, ingredients } from '../db/schema.js'
import { visibleAuthorIds, visibleRecipeWhere } from './recipeVisibility.js'
import type { RecipeWithIngredients } from './recipeMatcher.js'

export type RecipeWithCourse = RecipeWithIngredients & { course: Course | null }

/**
 * Every recipe the user may be served, shaped for the matcher: the weekly
 * generator, single-slot regenerations (menus.ts) and the assistant's swap
 * all load through here, so they apply the same filters (fit maps,
 * frequency, equipment, prep time, allergens).
 *
 * Visibility: catalogue + the user's and their household's own recipes —
 * never other users' private recipes (specs/recipes.md).
 * Allergens: the recipe's union plus each ingredient's catalogue tags, so
 * the restriction check doesn't depend on a stale recipe-level union.
 */
export async function loadMatchableRecipes(userId: string, db: any = defaultDb): Promise<RecipeWithCourse[]> {
  const allRecipes = await db.select().from(recipes).where(visibleRecipeWhere(await visibleAuthorIds(userId, db)))

  const recipeIds = allRecipes.map((r: any) => r.id)
  if (recipeIds.length === 0) return []

  const riRows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      ingredientName: ingredients.name,
      allergenTags: ingredients.allergenTags,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(inArray(recipeIngredients.recipeId, recipeIds))

  const ingredientsByRecipe = new Map<string, RecipeWithIngredients['ingredients']>()
  for (const row of riRows) {
    const list = ingredientsByRecipe.get(row.recipeId) ?? []
    list.push({
      ingredientId: row.ingredientId,
      ingredientName: row.ingredientName,
      quantity: row.quantity,
      unit: row.unit ?? 'g',
      allergenTags: row.allergenTags ?? [],
    })
    ingredientsByRecipe.set(row.recipeId, list)
  }

  return allRecipes.map((r: any) => ({
    id: r.id,
    name: r.name,
    meals: r.meals ?? [],
    seasons: r.seasons ?? [],
    // Three-state fit maps (migration 0024); legacy rows have null and the
    // matcher derives 'perfect' from the array tagging.
    mealFit: r.mealFit ?? undefined,
    seasonFit: r.seasonFit ?? undefined,
    // Frequency hint (migration 0026). Null = 'normal'.
    frequency: r.frequency ?? null,
    tags: r.tags ?? [],
    equipment: r.equipment ?? [],
    prepTime: r.prepTime ?? null,
    allergens: r.allergens ?? [],
    // Course classification for multi-dish slot building (starter/main/dessert).
    course: (r.course as Course | null | undefined) ?? null,
    ingredients: ingredientsByRecipe.get(r.id) ?? [],
  }))
}
