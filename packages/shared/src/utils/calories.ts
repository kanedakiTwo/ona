/**
 * Calculate calories for a given quantity of an ingredient.
 * Ingredient calories are per 100g.
 */
export function ingredientCalories(caloriesPer100g: number, quantityGrams: number): number {
  return (quantityGrams / 100) * caloriesPer100g
}

/**
 * Calculate total calories for a recipe given its ingredients.
 */
export function recipeCalories(
  ingredients: Array<{ calories: number; quantity: number }>,
): number {
  return ingredients.reduce(
    (sum, ing) => sum + ingredientCalories(ing.calories, ing.quantity),
    0,
  )
}

/**
 * Calculate total calories for a day's meals.
 */
export function dayCalories(recipeCalorieValues: number[]): number {
  return recipeCalorieValues.reduce((sum, cal) => sum + cal, 0)
}

/**
 * Calculate total calories for a full menu (multiple days).
 */
export function menuCalories(dayCalorieValues: number[]): number {
  return dayCalorieValues.reduce((sum, cal) => sum + cal, 0)
}
