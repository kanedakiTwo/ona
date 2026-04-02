import { eq } from 'drizzle-orm'
import { recipeIngredients, ingredients } from '../db/schema.js'
import { ingredientCalories } from '@ona/shared'
import type { DayMenu } from '@ona/shared'

type DB = Parameters<typeof import('../db/connection.js').db.select>[0] extends undefined
  ? typeof import('../db/connection.js').db
  : typeof import('../db/connection.js').db

/**
 * Calculate total calories for a recipe by fetching its ingredients from the DB.
 */
export async function calculateRecipeCaloriesFromDB(
  recipeId: string,
  db: any,
): Promise<number> {
  const rows = await db
    .select({
      quantity: recipeIngredients.quantity,
      calories: ingredients.calories,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(eq(recipeIngredients.recipeId, recipeId))

  return rows.reduce(
    (sum: number, row: { quantity: number; calories: number }) =>
      sum + ingredientCalories(row.calories, row.quantity),
    0,
  )
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
