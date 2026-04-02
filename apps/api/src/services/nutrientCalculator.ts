import { eq } from 'drizzle-orm'
import { recipeIngredients, ingredients } from '../db/schema.js'
import { ingredientNutrients, sumNutrients } from '@ona/shared'
import type { DayMenu } from '@ona/shared'

interface NutrientResult {
  protein: number
  carbohydrates: number
  fat: number
}

/**
 * Calculate total nutrients (protein, carbs, fat) for a recipe
 * by fetching its ingredients from the DB and summing weighted by quantity.
 */
export async function calculateRecipeNutrientsFromDB(
  recipeId: string,
  db: any,
): Promise<NutrientResult> {
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

  return sumNutrients(items)
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
