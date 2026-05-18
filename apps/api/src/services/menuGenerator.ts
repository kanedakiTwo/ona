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
import { findRecipeForSlot, normaliseEquipment, type RecipeWithIngredients } from './recipeMatcher.js'
import { getMemoryForUser } from './userMemoryStore.js'
import { resolveScope, scopeWhere } from './scopeResolver.js'
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

// Frontend ↔ backend meal-template shapes.
//
// The profile page stores `userSettings.template` as a junk-drawer blob:
//   { physical, preferences, mealTemplate: { [day]: string[] } }
// where day is a Spanish weekday ('lunes'…'domingo') and the values are
// Spanish meal names ('desayuno' | 'almuerzo' | 'merienda' | 'cena').
//
// The menu generator wants a 7-entry `DayTemplate[]` with the canonical
// enum keys ('breakfast' | 'lunch' | 'snack' | 'dinner'). Without this
// translation the cast `as DayTemplate[]` silently returns an object,
// `.length` is undefined, and every menu falls back to the default
// (all three meals on every day) — which is the bug Miguel hit when his
// "no breakfasts" preferences kept producing breakfasts anyway.
const SPANISH_DAY_INDEX: Record<string, number> = {
  lunes: 0, martes: 1, miercoles: 2, miércoles: 2, jueves: 3,
  viernes: 4, sabado: 5, sábado: 5, domingo: 6,
}
const SPANISH_TO_MEAL: Record<string, Meal> = {
  desayuno: 'breakfast',
  almuerzo: 'lunch',
  comida: 'lunch',
  merienda: 'snack',
  cena: 'dinner',
}

/**
 * Coerce whatever `userSettings.template` actually contains into a 7-day
 * `DayTemplate[]`. Returns null when the input carries no usable shape so
 * the caller can fall back to `defaultTemplate()`.
 */
export function normalizeMealTemplate(raw: unknown): DayTemplate[] | null {
  if (Array.isArray(raw) && raw.length === 7) {
    // Legacy DayTemplate[] — already the right shape.
    return raw as DayTemplate[]
  }
  // New shape: { mealTemplate: { [Spanish day]: Spanish meal[] } }, possibly
  // wrapped in the profile page's junk-drawer blob.
  const blob = raw as { mealTemplate?: Record<string, string[]> } | null
  const mt = blob && typeof blob === 'object' ? blob.mealTemplate : null
  if (!mt || typeof mt !== 'object') return null

  const out: DayTemplate[] = Array.from({ length: 7 }, () => ({}))
  let anySlot = false
  for (const [dayKey, meals] of Object.entries(mt)) {
    const idx = SPANISH_DAY_INDEX[dayKey.toLowerCase()]
    if (idx == null || !Array.isArray(meals)) continue
    for (const meal of meals) {
      const canonical = SPANISH_TO_MEAL[String(meal).toLowerCase()]
      if (canonical) {
        out[idx][canonical] = true
        anySlot = true
      }
    }
  }
  return anySlot ? out : null
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
    equipment: r.equipment ?? [],
    prepTime: r.prepTime ?? null,
    ingredients: ingredientsByRecipe.get(r.id) ?? [],
  }))
}

/**
 * Build a random menu for one iteration.
 */
// Spanish weekday names in the same Monday→Sunday order the menu uses.
const WEEKDAY_KEYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const

function buildRandomMenu(
  template: DayTemplate[],
  allRecipes: RecipeWithIngredients[],
  season: Season,
  restrictions: string[],
  favoriteRecipeIds: Set<string>,
  lockedSlots: LockedSlots,
  existingDays?: DayMenu[],
  bannedRecipeIds?: Set<string>,
  skippedDays?: Set<number>,
  dislikes?: string[],
  availableEquipment?: Set<string>,
  timeBudgetByDay?: Record<number, number>,
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

    // Skip days the user marked "sin cocinar" — slots stay empty, the
    // user reactivates the day manually if plans change.
    if (skippedDays?.has(dayIndex)) {
      days.push(dayMenu)
      continue
    }

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
        bannedRecipeIds,
        dislikes,
        availableEquipment,
        maxPrepMinutes: timeBudgetByDay?.[dayIndex] ?? null,
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
  bannedRecipeIds?: Set<string>,
  skippedDays?: Set<number>,
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

  // The frontend stores `template` as a junk-drawer blob (physical +
  // preferences + mealTemplate); normalize it back to DayTemplate[] before
  // letting the matcher loop over it.
  const rawTemplate = customTemplate ?? settings?.template
  const template = normalizeMealTemplate(rawTemplate) ?? defaultTemplate()

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

  // Fetch favorites — household-scoped when flag is on so the matcher
  // boosts any starred recipe across the household.
  const favScope = await resolveScope(userId)
  const favRows = await db
    .select({ recipeId: userFavorites.recipeId })
    .from(userFavorites)
    .where(scopeWhere(userFavorites.userId, userFavorites.householdId, favScope))

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

  // 4. Restrictions + dislikes + equipment + time-budget from long-term memory
  const restrictions: string[] = user.restrictions ?? []
  const memory = await getMemoryForUser(userId).catch(() => null)
  const dislikesValue = memory?.dislikes?.value
  const dislikes: string[] = Array.isArray(dislikesValue) ? (dislikesValue as string[]) : []
  const equipmentValue = memory?.equipment?.value
  const availableEquipment = Array.isArray(equipmentValue)
    ? new Set<string>((equipmentValue as string[]).map(normaliseEquipment))
    : undefined
  const timeValue = memory?.time_available?.value as Record<string, number> | undefined
  const timeBudgetByDay: Record<number, number> = {}
  if (timeValue && typeof timeValue === 'object') {
    for (let i = 0; i < WEEKDAY_KEYS.length; i++) {
      const v = timeValue[WEEKDAY_KEYS[i]]
      if (typeof v === 'number' && v > 0) timeBudgetByDay[i] = v
    }
  }

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
      bannedRecipeIds,
      skippedDays,
      dislikes,
      availableEquipment,
      timeBudgetByDay,
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
    bannedRecipeIds,
    skippedDays,
    dislikes,
    availableEquipment,
    timeBudgetByDay,
  )
}
