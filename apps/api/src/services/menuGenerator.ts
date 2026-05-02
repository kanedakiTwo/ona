import { eq, inArray } from 'drizzle-orm'
import {
  users,
  userSettings,
  recipes,
  recipeIngredients,
  ingredients,
  userFavorites,
} from '../db/schema.js'
import {
  calculateMenuTargetCalories,
  detectSeason,
  nutrientsToPercentages,
  normalizeDeviation,
  TARGET_MACROS,
  MENU_GENERATION,
} from '@ona/shared'
import type { DayMenu, DayTemplate, Meal, Season, Sex, ActivityLevel, LockedSlots } from '@ona/shared'
import { findRecipeForSlot, type RecipeWithIngredients } from './recipeMatcher.js'
import { calculateRecipeCaloriesFromDB, calculateMenuCaloriesFromDB } from './calorieCalculator.js'
import { calculateMenuNutrientsFromDB } from './nutrientCalculator.js'

/**
 * Default 7-day template: breakfast, lunch, dinner every day.
 */
function defaultTemplate(): DayTemplate[] {
  return Array.from({ length: 7 }, () => ({
    breakfast: true,
    lunch: true,
    dinner: true,
  }))
}

/**
 * Count total meal slots in a template.
 */
function countMealSlots(template: DayTemplate[]): number {
  let count = 0
  for (const day of template) {
    for (const meal of Object.keys(day)) {
      if (day[meal]) count++
    }
  }
  return count
}

/**
 * Load all recipes with their ingredient names from the DB.
 */
async function loadRecipesWithIngredients(db: any): Promise<RecipeWithIngredients[]> {
  const allRecipes = await db.select().from(recipes)

  const recipeIds = allRecipes.map((r: any) => r.id)
  if (recipeIds.length === 0) return []

  const riRows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      ingredientName: ingredients.name,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))

  // Group ingredients by recipe
  const ingredientsByRecipe = new Map<string, any[]>()
  for (const row of riRows) {
    const list = ingredientsByRecipe.get(row.recipeId) ?? []
    list.push({
      ingredientId: row.ingredientId,
      ingredientName: row.ingredientName,
      quantity: row.quantity,
      unit: row.unit ?? 'g',
    })
    ingredientsByRecipe.set(row.recipeId, list)
  }

  return allRecipes.map((r: any) => ({
    id: r.id,
    name: r.name,
    meals: r.meals ?? [],
    seasons: r.seasons ?? [],
    tags: r.tags ?? [],
    ingredients: ingredientsByRecipe.get(r.id) ?? [],
  }))
}

/**
 * Build a random menu for one iteration.
 */
function buildRandomMenu(
  template: DayTemplate[],
  allRecipes: RecipeWithIngredients[],
  season: Season,
  restrictions: string[],
  favoriteRecipeIds: Set<string>,
  lockedSlots: LockedSlots,
  existingDays?: DayMenu[],
): DayMenu[] {
  const usedRecipeIds = new Set<string>()
  const days: DayMenu[] = []

  // If there are locked slots, pre-fill them and mark as used
  if (existingDays) {
    for (const dayIndexStr of Object.keys(lockedSlots)) {
      const dayIndex = parseInt(dayIndexStr, 10)
      const dayLocks = lockedSlots[dayIndexStr]
      if (!dayLocks || !existingDays[dayIndex]) continue
      for (const meal of Object.keys(dayLocks)) {
        if (dayLocks[meal] && existingDays[dayIndex][meal]?.recipeId) {
          usedRecipeIds.add(existingDays[dayIndex][meal]!.recipeId)
        }
      }
    }
  }

  for (let dayIndex = 0; dayIndex < template.length; dayIndex++) {
    const dayTemplate = template[dayIndex]
    const dayMenu: DayMenu = {}

    for (const meal of Object.keys(dayTemplate)) {
      if (!dayTemplate[meal]) continue

      // Check if this slot is locked
      const isLocked =
        existingDays &&
        lockedSlots[String(dayIndex)]?.[meal] &&
        existingDays[dayIndex]?.[meal]?.recipeId

      if (isLocked) {
        dayMenu[meal] = existingDays[dayIndex][meal]
        continue
      }

      const recipe = findRecipeForSlot(allRecipes, {
        meal: meal as Meal,
        season,
        usedRecipeIds,
        restrictions,
        favoriteRecipeIds,
      })

      if (recipe) {
        dayMenu[meal] = { recipeId: recipe.id, recipeName: recipe.name }
        usedRecipeIds.add(recipe.id)
      }
    }

    days.push(dayMenu)
  }

  return days
}

/**
 * Score a menu's fitness. Lower is better.
 * fitness = calorieDeviation + nutrientPercentageDeviation + unmappedPenalty
 *
 * Uses cached `recipe.nutritionPerServing` when available; legacy recipes
 * (whose nutrition is null) still score but get a small penalty so the
 * algorithm prefers fully-mapped alternatives.
 */
async function scoreMenu(
  days: DayMenu[],
  targetCalories: number,
  db: any,
  unmappedRecipeIds: Set<string>,
): Promise<number> {
  const totalCalories = await calculateMenuCaloriesFromDB(days, db)
  const nutrients = await calculateMenuNutrientsFromDB(days, db)
  const percentages = nutrientsToPercentages(nutrients)

  const calorieDeviation = normalizeDeviation(targetCalories, totalCalories)
  const carbsDeviation = normalizeDeviation(TARGET_MACROS.carbohydrates, percentages.carbohydrates)
  const fatDeviation = normalizeDeviation(TARGET_MACROS.fat, percentages.fat)
  const proteinDeviation = normalizeDeviation(TARGET_MACROS.protein, percentages.protein)

  // Small penalty per unmapped slot to break ties in favor of recipes with
  // cached nutrition. Trivial when all recipes are mapped.
  let unmappedPenalty = 0
  for (const day of days) {
    for (const meal of Object.keys(day)) {
      const slot = day[meal]
      if (slot?.recipeId && unmappedRecipeIds.has(slot.recipeId)) unmappedPenalty += 0.05
    }
  }

  return calorieDeviation + carbsDeviation + fatDeviation + proteinDeviation + unmappedPenalty
}

/**
 * Core menu generation algorithm.
 *
 * 1. Fetch user profile, settings template, all eligible recipes, user favorites
 * 2. Calculate target calories using BMR * activity * numberOfMeals
 * 3. Determine current season
 * 4. Filter recipes by user restrictions
 * 5. Boost favorites (higher probability in pool)
 * 6. Run iterative optimization (up to 200 iterations)
 * 7. Return the best menu's days array
 */
export async function generateMenu(
  userId: string,
  weekStart: string,
  customTemplate: DayTemplate[] | undefined,
  db: any,
  lockedSlots: LockedSlots = {},
  existingDays?: DayMenu[],
): Promise<DayMenu[]> {
  // 1. Fetch user profile
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new Error('User not found')

  // Fetch user settings template
  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1)

  const rawTemplate = customTemplate ?? (settings?.template as DayTemplate[])
  const template: DayTemplate[] =
    rawTemplate && rawTemplate.length > 0 ? rawTemplate : defaultTemplate()

  // Fetch all recipes with ingredients
  const allRecipes = await loadRecipesWithIngredients(db)

  // Identify recipes whose nutritionPerServing isn't cached yet — they get a
  // tiny fitness penalty so the algorithm prefers fully-mapped alternatives.
  const nutritionRows = await db
    .select({ id: recipes.id, nutritionPerServing: recipes.nutritionPerServing })
    .from(recipes)
  const unmappedRecipeIds = new Set<string>(
    nutritionRows
      .filter((r: any) => !r.nutritionPerServing || (r.nutritionPerServing as any)?.kcal == null)
      .map((r: any) => r.id),
  )

  // Fetch user favorites
  const favRows = await db
    .select({ recipeId: userFavorites.recipeId })
    .from(userFavorites)
    .where(eq(userFavorites.userId, userId))

  const favoriteRecipeIds = new Set<string>(favRows.map((f: any) => f.recipeId))

  // 2. Calculate target calories
  const sex = (user.sex as Sex) ?? 'male'
  const weight = user.weight ?? 70
  const height = user.height ?? 170
  const age = user.age ?? 30
  const activity = (user.activityLevel as ActivityLevel) ?? 'none'
  const totalMeals = countMealSlots(template)

  const targetCalories = calculateMenuTargetCalories(sex, weight, height, age, activity, totalMeals)

  // 3. Current season
  const season = detectSeason()

  // 4. Restrictions
  const restrictions: string[] = user.restrictions ?? []

  // 6. Iterative optimization
  let bestDays: DayMenu[] | null = null
  let bestFitness: number = MENU_GENERATION.MIN_FITNESS

  for (let i = 0; i < MENU_GENERATION.MAX_ITERATIONS; i++) {
    const candidateDays = buildRandomMenu(
      template,
      allRecipes,
      season,
      restrictions,
      favoriteRecipeIds,
      lockedSlots,
      existingDays,
    )

    // Verify the menu has at least some recipes
    const hasRecipes = candidateDays.some((day) =>
      Object.values(day).some((slot) => slot?.recipeId),
    )
    if (!hasRecipes) continue

    const fitness = await scoreMenu(candidateDays, targetCalories, db, unmappedRecipeIds)

    if (fitness < bestFitness) {
      bestFitness = fitness
      bestDays = candidateDays
    }

    // Early stop if fitness is good enough
    if (bestFitness < MENU_GENERATION.OPTIMAL_FITNESS) break
  }

  return bestDays ?? buildRandomMenu(
    template,
    allRecipes,
    season,
    restrictions,
    favoriteRecipeIds,
    lockedSlots,
    existingDays,
  )
}
