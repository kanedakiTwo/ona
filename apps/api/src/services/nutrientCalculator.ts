import { eq } from 'drizzle-orm'
import { recipes, recipeIngredients, ingredients } from '../db/schema.js'
import { ingredientNutrients, sumNutrients } from '@ona/shared'
import type { DayMenu, NutritionPerServing } from '@ona/shared'

interface NutrientResult {
  protein: number
  carbohydrates: number
  fat: number
}

/**
 * Calculate per-serving nutrients (protein, carbs, fat) for a recipe.
 *
 * Prefers `recipe.nutritionPerServing` (Task 11 cache). Falls back to ingredient
 * sum divided by `recipe.servings` for unmapped legacy rows.
 */
export async function calculateRecipeNutrientsFromDB(
  recipeId: string,
  db: any,
): Promise<NutrientResult> {
  const [recipe] = await db
    .select({
      servings: recipes.servings,
      nutritionPerServing: recipes.nutritionPerServing,
    })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1)

  const cached = recipe?.nutritionPerServing as NutritionPerServing | null
  if (cached && cached.proteinG != null) {
    return {
      protein: cached.proteinG,
      carbohydrates: cached.carbsG ?? 0,
      fat: cached.fatG ?? 0,
    }
  }

  const rows = await db
    .select({
      quantity: recipeIngredients.quantity,
      protein: ingredients.protein,
      carbs: ingredients.carbs,
      fat: ingredients.fat,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(eq(recipeIngredients.recipeId, recipeId))

  const items = rows.map(
    (row: { protein: number; carbs: number; fat: number; quantity: number }) =>
      ingredientNutrients(row.protein ?? 0, row.carbs ?? 0, row.fat ?? 0, row.quantity),
  )

  const total = sumNutrients(items)
  const servings = recipe?.servings ?? 1
  if (servings > 0 && servings !== 1) {
    return {
      protein: total.protein / servings,
      carbohydrates: total.carbohydrates / servings,
      fat: total.fat / servings,
    }
  }
  return total
}

/**
 * Calculate total nutrients for a full menu from its days array.
 * Sums protein, carbs, and fat across all recipes in the menu.
 */
export async function calculateMenuNutrientsFromDB(
  menuDays: DayMenu[],
  db: any,
): Promise<NutrientResult> {
  const recipeIds = new Set<string>()
  const recipeNutrientsMap = new Map<string, NutrientResult>()

  // Collect all unique recipe IDs
  for (const day of menuDays) {
    for (const meal of Object.keys(day)) {
      const slot = day[meal]
      if (slot?.recipeId) {
        recipeIds.add(slot.recipeId)
      }
    }
  }

  // Calculate nutrients for each unique recipe
  for (const recipeId of recipeIds) {
    const nutrients = await calculateRecipeNutrientsFromDB(recipeId, db)
    recipeNutrientsMap.set(recipeId, nutrients)
  }

  // Sum total nutrients across all days and meals
  const allNutrients: NutrientResult[] = []
  for (const day of menuDays) {
    for (const meal of Object.keys(day)) {
      const slot = day[meal]
      if (slot?.recipeId) {
        const n = recipeNutrientsMap.get(slot.recipeId)
        if (n) allNutrients.push(n)
      }
    }
  }

  return sumNutrients(allNutrients)
}
