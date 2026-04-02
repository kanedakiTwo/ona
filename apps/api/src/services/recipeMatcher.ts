import type { Meal, Season } from '@ona/shared'
import { isInSeason } from '@ona/shared'

export interface RecipeWithIngredients {
  id: string
  name: string
  meals: string[]
  seasons: string[]
  tags: string[]
  ingredients: Array<{
    ingredientId: string
    ingredientName: string
    quantity: number
    unit: string
  }>
}

export interface MatcherOptions {
  meal: Meal
  season: Season
  usedRecipeIds: Set<string>
  restrictions: string[]
  favoriteRecipeIds: Set<string>
}

/**
 * Filter recipes that match ALL predicates for a meal slot:
 * 1. Recipe's meals array includes the target meal type
 * 2. Recipe's seasons array includes current season (or empty = all seasons)
 * 3. Recipe is not already used in the current menu (no repeats)
 * 4. Recipe's ingredients don't contain restricted items
 *
 * Favorites appear with higher probability (duplicated in pool).
 */
export function matchRecipes(
  recipes: RecipeWithIngredients[],
  options: MatcherOptions,
): RecipeWithIngredients[] {
  const { meal, season, usedRecipeIds, restrictions } = options

  const restrictionSet = new Set(restrictions.map((r) => r.toLowerCase()))

  return recipes.filter((recipe) => {
    // 1. Meal type match
    if (!recipe.meals.includes(meal)) return false

    // 2. Season match
    if (!isInSeason(recipe.seasons as Season[], season)) return false

    // 3. No repeats in the week
    if (usedRecipeIds.has(recipe.id)) return false

    // 4. Restriction check - recipe ingredients must not contain restricted items
    if (restrictionSet.size > 0) {
      const hasRestricted = recipe.ingredients.some((ing) =>
        restrictionSet.has(ing.ingredientName.toLowerCase()),
      )
      if (hasRestricted) return false
    }

    return true
  })
}

/**
 * Pick a random recipe from the filtered pool.
 * Favorites get boosted probability (appear twice in the selection pool).
 */
export function pickRandom(
  candidates: RecipeWithIngredients[],
  favoriteRecipeIds: Set<string>,
): RecipeWithIngredients | undefined {
  if (candidates.length === 0) return undefined

  // Build weighted pool: favorites appear twice
  const pool: RecipeWithIngredients[] = []
  for (const recipe of candidates) {
    pool.push(recipe)
    if (favoriteRecipeIds.has(recipe.id)) {
      pool.push(recipe)
    }
  }

  const index = Math.floor(Math.random() * pool.length)
  return pool[index]
}

/**
 * Find a matching recipe for a meal slot. Returns undefined if none found.
 */
export function findRecipeForSlot(
  recipes: RecipeWithIngredients[],
  options: MatcherOptions,
): RecipeWithIngredients | undefined {
  const candidates = matchRecipes(recipes, options)
  return pickRandom(candidates, options.favoriteRecipeIds)
}
