import { eq } from 'drizzle-orm'
import { recipes, recipeIngredients, ingredients } from '../db/schema.js'
import { ingredientCalories } from '@ona/shared'
import type { DayMenu, NutritionPerServing } from '@ona/shared'

/**
 * Calculate kcal per serving for a recipe.
 *
 * Prefers the cached `recipe.nutritionPerServing.kcal` (Task 11 wires this on
 * every save). Falls back to summing ingredient calories and dividing by
 * `recipe.servings` for unmapped legacy rows.
 */
export async function calculateRecipeCaloriesFromDB(
  recipeId: string,
  db: any,
): Promise<number> {
  const [recipe] = await db
    .select({
      servings: recipes.servings,
      nutritionPerServing: recipes.nutritionPerServing,
    })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1)

  const cached = recipe?.nutritionPerServing as NutritionPerServing | null
  if (cached?.kcal != null) return cached.kcal

  // Fallback: legacy sum across ingredients / servings → per-serving kcal
  const rows = await db
    .select({
      quantity: recipeIngredients.quantity,
      calories: ingredients.calories,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(eq(recipeIngredients.recipeId, recipeId))

  const total = rows.reduce(
    (sum: number, row: { quantity: number; calories: number }) =>
      sum + ingredientCalories(row.calories ?? 0, row.quantity),
    0,
  )

  const servings = recipe?.servings ?? 1
  return servings > 0 ? total / servings : total
}

/**
 * Calculate total calories for a full menu from its days array.
 * Each day is a DayMenu with meal slots containing recipeIds.
 */
export async function calculateMenuCaloriesFromDB(
  menuDays: DayMenu[],
  db: any,
): Promise<number> {
  const recipeIds = new Set<string>()
  const recipeCaloriesMap = new Map<string, number>()

  // Collect all unique recipe IDs
  for (const day of menuDays) {
    for (const meal of Object.keys(day)) {
      const slot = day[meal]
      if (slot?.recipeId) {
        recipeIds.add(slot.recipeId)
      }
    }
  }

  // Calculate calories for each unique recipe
  for (const recipeId of recipeIds) {
    const cal = await calculateRecipeCaloriesFromDB(recipeId, db)
    recipeCaloriesMap.set(recipeId, cal)
  }

  // Sum total calories across all days and meals
  let total = 0
  for (const day of menuDays) {
    for (const meal of Object.keys(day)) {
      const slot = day[meal]
      if (slot?.recipeId) {
        total += recipeCaloriesMap.get(slot.recipeId) ?? 0
      }
    }
  }

  return total
}
