import type { NutrientBalance } from '../types/nutrition.js'
import { EMA_WEIGHTS } from '../constants/nutrition.js'

/**
 * Calculate nutrient values for a given quantity of an ingredient.
 * Values are per 100g.
 */
export function ingredientNutrients(
  protein: number,
  carbs: number,
  fat: number,
  quantityGrams: number,
): { protein: number; carbohydrates: number; fat: number } {
  const factor = quantityGrams / 100
  return {
    protein: protein * factor,
    carbohydrates: carbs * factor,
    fat: fat * factor,
  }
}

/**
 * Sum nutrients from multiple sources.
 */
export function sumNutrients(
  items: Array<{ protein: number; carbohydrates: number; fat: number }>,
): { protein: number; carbohydrates: number; fat: number } {
  return items.reduce(
    (acc, item) => ({
      protein: acc.protein + item.protein,
      carbohydrates: acc.carbohydrates + item.carbohydrates,
      fat: acc.fat + item.fat,
    }),
    { protein: 0, carbohydrates: 0, fat: 0 },
  )
}

/**
 * Convert absolute nutrient values to percentages.
 */
export function nutrientsToPercentages(nutrients: { protein: number; carbohydrates: number; fat: number }): {
  protein: number
  carbohydrates: number
  fat: number
} {
  const total = nutrients.protein + nutrients.carbohydrates + nutrients.fat
  if (total === 0) return { protein: 0, carbohydrates: 0, fat: 0 }
  return {
    protein: (nutrients.protein * 100) / total,
    carbohydrates: (nutrients.carbohydrates * 100) / total,
    fat: (nutrients.fat * 100) / total,
  }
}

/**
 * Exponential Moving Average for nutrient balance tracking.
 * newBalance = new * 0.7 + old * 0.3
 */
export function updateNutrientBalance(
  newNutrients: NutrientBalance,
  currentBalance?: NutrientBalance,
): NutrientBalance {
  if (!currentBalance) return newNutrients
  return {
    protein: newNutrients.protein * EMA_WEIGHTS.NEW + currentBalance.protein * EMA_WEIGHTS.OLD,
    carbohydrates: newNutrients.carbohydrates * EMA_WEIGHTS.NEW + currentBalance.carbohydrates * EMA_WEIGHTS.OLD,
    fat: newNutrients.fat * EMA_WEIGHTS.NEW + currentBalance.fat * EMA_WEIGHTS.OLD,
  }
}

/**
 * Calculate normalized deviation (fitness component).
 * |actual/target - 1| × 100
 */
export function normalizeDeviation(target: number, actual: number): number {
  if (target === 0) return 0
  return Math.abs((actual * 100) / target - 100)
}
