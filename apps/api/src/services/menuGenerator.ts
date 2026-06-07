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
import { findForCourse } from './courseAwareMatcher.js'
import { dishCountFor, coursesFor } from './menuDishes.js'
import { getMemoryForUser } from './userMemoryStore.js'
import { resolveScope, scopeWhere } from './scopeResolver.js'
import { calculateRecipeCaloriesFromDB, calculateMenuCaloriesFromDB } from './calorieCalculator.js'
import { calculateMenuNutrientsFromDB } from './nutrientCalculator.js'
import type { MealDishCounts, Dish, RecipeDish, Course } from '@ona/shared'

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
 *
 * Accepts three input shapes (in order of precedence):
 *   1. Legacy `DayTemplate[]` (already the right shape).
 *   2. `{ mealTemplate: { [Spanish day]: Spanish meal[] } }` — pure on/off.
 *   3. `{ mealTemplate: { [Spanish day]: { [Spanish meal]: number } } }` —
 *      the post-2026-05-30 shape that also carries per-slot diner counts.
 *      We accept any positive number here; the 0/absent meaning "off" is
 *      enforced by the UI's stepper component, but we also treat 0 as off
 *      defensively so historical writes can't accidentally enable a slot.
 */
export function normalizeMealTemplate(raw: unknown): DayTemplate[] | null {
  if (Array.isArray(raw) && raw.length === 7) {
    // Legacy DayTemplate[] — already the right shape.
    return raw as DayTemplate[]
  }
  // `mealTemplate` lives either at the top level or nested inside the
  // profile page's junk-drawer blob ({ physical, preferences, mealTemplate }).
  const blob = raw as { mealTemplate?: unknown } | null
  const mt = blob && typeof blob === 'object' ? blob.mealTemplate : null
  if (!mt || typeof mt !== 'object') return null

  const out: DayTemplate[] = Array.from({ length: 7 }, () => ({}))
  let anySlot = false
  for (const [dayKey, meals] of Object.entries(mt)) {
    const idx = SPANISH_DAY_INDEX[dayKey.toLowerCase()]
    if (idx == null) continue
    if (Array.isArray(meals)) {
      for (const meal of meals) {
        const canonical = SPANISH_TO_MEAL[String(meal).toLowerCase()]
        if (canonical) {
          out[idx][canonical] = true
          anySlot = true
        }
      }
    } else if (meals && typeof meals === 'object') {
      for (const [mealKey, count] of Object.entries(meals as Record<string, unknown>)) {
        const canonical = SPANISH_TO_MEAL[mealKey.toLowerCase()]
        if (!canonical) continue
        const n = typeof count === 'number' ? count : NaN
        if (Number.isFinite(n) && n > 0) {
          out[idx][canonical] = true
          anySlot = true
        }
      }
    }
  }
  return anySlot ? out : null
}

/**
 * Per-slot diner counts paired with `normalizeMealTemplate`'s output.
 *
 * Returns a 7-entry array (indexed 0=Monday…6=Sunday); each entry maps a
 * canonical meal key ('breakfast' | 'lunch' | 'snack' | 'dinner') to the
 * positive integer of diners the user wants in that slot. Missing entries
 * mean "use the household default" (the same fallback applied to slots
 * generated without any template input).
 *
 * Accepts the same input shapes as `normalizeMealTemplate`; legacy on/off
 * shapes produce an empty result so callers fall back to the household
 * multiplier untouched.
 */
export function extractMealDiners(raw: unknown): Record<Meal, number>[] {
  const out: Record<Meal, number>[] = Array.from(
    { length: 7 },
    () => ({}) as Record<Meal, number>,
  )
  const blob = raw as { mealTemplate?: unknown } | null
  const mt = blob && typeof blob === 'object' ? blob.mealTemplate : null
  if (!mt || typeof mt !== 'object') return out
  for (const [dayKey, meals] of Object.entries(mt)) {
    const idx = SPANISH_DAY_INDEX[dayKey.toLowerCase()]
    if (idx == null || !meals || typeof meals !== 'object' || Array.isArray(meals)) {
      continue
    }
    for (const [mealKey, count] of Object.entries(meals as Record<string, unknown>)) {
      const canonical = SPANISH_TO_MEAL[mealKey.toLowerCase()]
      if (!canonical) continue
      const n = typeof count === 'number' ? count : NaN
      if (Number.isFinite(n) && n > 0) {
        out[idx][canonical] = Math.floor(n)
      }
    }
  }
  return out
}

/**
 * Per-meal-type dish count, parsed from userSettings.template's junk-drawer
 * blob: `{ mealDishCounts: { breakfast?: 1|2|3, lunch?: 1|2|3, ... } }`.
 * Missing entries default to 1 in `dishCountFor`. Invalid values (anything
 * outside 1/2/3) are dropped.
 */
export function extractMealDishCounts(raw: unknown): MealDishCounts {
  if (!raw || typeof raw !== 'object') return {}
  const blob = raw as { mealDishCounts?: unknown }
  const mdc = blob.mealDishCounts
  if (!mdc || typeof mdc !== 'object') return {}
  const out: MealDishCounts = {}
  for (const [meal, count] of Object.entries(mdc as Record<string, unknown>)) {
    if (count === 1 || count === 2 || count === 3) {
      out[meal as keyof MealDishCounts] = count
    }
  }
  return out
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

type RecipeWithCourse = RecipeWithIngredients & { course: Course | null }

/**
 * Load all recipes with their ingredient names from the DB.
 */
async function loadRecipesWithIngredients(db: any): Promise<RecipeWithCourse[]> {
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
    // Three-state fit maps. `meal_fit` / `season_fit` are jsonb columns
    // added in migration 0024; legacy rows have null — the matcher
    // handles that branch and derives 'perfect' from the array tagging.
    mealFit: r.mealFit ?? undefined,
    seasonFit: r.seasonFit ?? undefined,
    // Frequency hint (migration 0026). Null = 'normal' default; the
    // matcher reads it for pool-weighting + the weekends-only filter.
    frequency: r.frequency ?? null,
    tags: r.tags ?? [],
    equipment: r.equipment ?? [],
    prepTime: r.prepTime ?? null,
    // Course classification for multi-dish slot building (starter/main/dessert).
    course: (r.course as Course | null | undefined) ?? null,
    ingredients: ingredientsByRecipe.get(r.id) ?? [],
  })) as (RecipeWithIngredients & { course: Course | null })[]
}

/**
 * Build a random menu for one iteration.
 */
// Spanish weekday names in the same Monday→Sunday order the menu uses.
const WEEKDAY_KEYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const

function buildRandomMenu(
  template: DayTemplate[],
  allRecipes: RecipeWithCourse[],
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
  mealDiners?: Record<Meal, number>[],
  mealDishCounts?: MealDishCounts,
): { days: DayMenu[]; warnings: string[] } {
  const usedRecipeIds = new Set<string>()
  const days: DayMenu[] = []
  const warnings: string[] = []

  // If there are locked slots, pre-fill them and mark as used
  if (existingDays) {
    for (const dayIndexStr of Object.keys(lockedSlots)) {
      const dayIndex = parseInt(dayIndexStr, 10)
      const dayLocks = lockedSlots[dayIndexStr]
      if (!dayLocks || !existingDays[dayIndex]) continue
      for (const meal of Object.keys(dayLocks)) {
        const slot = existingDays[dayIndex][meal]
        if (dayLocks[meal] && slot) {
          // Pre-mark all recipe dishes in locked slots as used
          for (const dish of slot.dishes ?? []) {
            if (dish.kind === 'recipe') usedRecipeIds.add(dish.recipeId)
          }
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
        existingDays[dayIndex]?.[meal]

      if (isLocked) {
        dayMenu[meal] = existingDays![dayIndex][meal]
        continue
      }

      const dinerOverride = mealDiners?.[dayIndex]?.[meal as Meal]
      const defaultDinersForSlot = dinerOverride && dinerOverride > 0 ? dinerOverride : undefined

      const wantedCount = dishCountFor(meal as Meal, mealDishCounts ?? {})
      const wantedCourses = coursesFor(wantedCount)
      const dishes: Dish[] = []

      for (const course of wantedCourses) {
        const picked = findForCourse(allRecipes, course, {
          meal: meal as Meal,
          season,
          usedRecipeIds,
          restrictions,
          favoriteRecipeIds,
          bannedRecipeIds,
          dayIndex,
          dislikes,
          availableEquipment,
          maxPrepMinutes: timeBudgetByDay?.[dayIndex] ?? null,
        })
        if (!picked) {
          warnings.push(`no_${course ?? 'main'}_available_${meal}_d${dayIndex}`)
          continue
        }
        usedRecipeIds.add(picked.id)
        dishes.push({
          kind: 'recipe',
          recipeId: picked.id,
          recipeName: picked.name,
          course: (picked as RecipeWithCourse).course ?? null,
        } as RecipeDish)
      }

      // Set the new-shape slot (only if we got at least one dish)
      if (dishes.length > 0) {
        dayMenu[meal] = {
          ...(defaultDinersForSlot !== undefined ? { servings: defaultDinersForSlot } : {}),
          dishes,
        }
      }
    }

    days.push(dayMenu)
  }

  return { days, warnings }
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
      for (const dish of slot?.dishes ?? []) {
        if (dish.kind === 'recipe' && unmappedRecipeIds.has(dish.recipeId)) unmappedPenalty += 0.05
      }
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
): Promise<{ days: DayMenu[]; warnings: string[] }> {
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
  // Per-slot diner counts (only present when the profile's plantilla uses the
  // numeric shape `{ [day]: { [meal]: number } }`). Slots that didn't carry an
  // explicit count keep `servings` undefined and fall back to the household
  // multiplier in the shopping-list aggregator.
  const mealDiners = extractMealDiners(rawTemplate)
  // Per-meal-type dish count from the same junk-drawer blob:
  // `{ mealDishCounts: { lunch: 2, dinner: 3 } }`. Absent = all 1-dish.
  const mealDishCounts = extractMealDishCounts(rawTemplate)

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
  let bestWarnings: string[] = []

  for (let i = 0; i < MENU_GENERATION.MAX_ITERATIONS; i++) {
    const { days: candidateDays, warnings: candidateWarnings } = buildRandomMenu(
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
      mealDiners,
      mealDishCounts,
    )

    // Verify the menu has at least some recipes
    const hasRecipes = candidateDays.some((day) =>
      Object.values(day).some((slot) => (slot?.dishes?.length ?? 0) > 0),
    )
    if (!hasRecipes) continue

    const fitness = await scoreMenu(candidateDays, targetCalories, db, unmappedRecipeIds)

    if (fitness < bestFitness) {
      bestFitness = fitness
      bestDays = candidateDays
      bestWarnings = candidateWarnings
    }

    // Early stop if fitness is good enough
    if (bestFitness < MENU_GENERATION.OPTIMAL_FITNESS) break
  }

  if (bestDays) {
    return { days: bestDays, warnings: bestWarnings }
  }

  const fallback = buildRandomMenu(
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
    mealDiners,
    mealDishCounts,
  )
  return { days: fallback.days, warnings: fallback.warnings }
}
