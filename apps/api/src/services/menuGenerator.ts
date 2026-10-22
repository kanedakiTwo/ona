import { eq, inArray } from 'drizzle-orm'
import { loadHouseholdRatingSets, withHouseholdRatings } from './householdRatings.js'
import { visibleAuthorIds, visibleRecipeWhere } from './recipeVisibility.js'
import { loadMatchableRecipes, type RecipeWithCourse } from './matchableRecipes.js'
import { mergeRestrictions } from './dietaryRestrictions.js'
import { withHouseholdRestrictions } from './householdAllergies.js'
import { recipesMatchingDishes, weekTimeBudgets } from './onboardingPreferences.js'
import { holidayTimeBudgets, regionFromMemory } from './menuHolidays.js'
import { menuMetabolicQuality, recipeMetabolicProfile, type MetabolicProfile } from './metabolicScore.js'
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
import { applyTemplateTapers } from './taper.js'
import type { DayMenu, DayTemplate, DayTimeBudget, Meal, Season, Sex, ActivityLevel, LockedSlots, WeekPlan } from '@ona/shared'
import { applyWeekPlan } from './weekPlan.js'
import { ensureFridgeRecipe, loadFridgeTerms, recipesUsingFridge, rememberFridge } from './fridgeBoost.js'
import { findRecipeForSlot, normaliseEquipment, type RecipeWithIngredients } from './recipeMatcher.js'
import { findForCourse } from './courseAwareMatcher.js'
import { proteinKind } from './tasteDeck.js'
import { dishCountFor, coursesFor } from './menuDishes.js'
import { getMemoryForUser } from './userMemoryStore.js'
import { loadFichaMenuConstraints, withFichaFilters } from './profile/reader.js'
import { resolveScope, scopeWhere } from './scopeResolver.js'
import { calculateRecipeCaloriesFromDB, calculateMenuCaloriesFromDB } from './calorieCalculator.js'
import { calculateMenuNutrientsFromDB } from './nutrientCalculator.js'
import type { MealDishCounts, Dish, RecipeDish, Course, FixedMeal, FoodGroup } from '@ona/shared'
import { fixedMealFor, fixedMealsFromTemplate, fixedNoteText } from '@ona/shared'
import { loadSchoolDinnerAvoidGroups, withoutFoodGroup } from './schoolMenu.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'

/**
 * Lunch + dinner every day, until the user sets their own plantilla in the
 * profile. Breakfast is opt-in: few households plan it, and with breakfast on
 * by default most new menus came back with `no_main_available_breakfast_*`
 * warnings and empty breakfast slots.
 */
export function defaultTemplate(): DayTemplate[] {
  return Array.from({ length: 7 }, () => ({
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
 * Pure (PRO-218): the template without the fixed meals' slots, so the
 * generator never picks a recipe for them.
 */
export function templateWithoutFixed(template: DayTemplate[], fixed: readonly FixedMeal[]): DayTemplate[] {
  if (fixed.length === 0) return template
  return template.map((day, i) => {
    const out: DayTemplate = { ...day }
    for (const meal of Object.keys(out)) if (fixedMealFor(fixed, i, meal)) delete out[meal]
    return out
  })
}

/**
 * Pure (PRO-218): put the fixed meals into the generated week as one note
 * «Fijo: <label>» carrying its items (the shopping list reads them). A locked
 * slot keeps what it had; a «sin cocinar» day stays empty; the slot takes the
 * plantilla's diners when it has them.
 */
export function withFixedMeals(
  days: DayMenu[],
  fixed: readonly FixedMeal[],
  opts: { lockedSlots?: LockedSlots; existingDays?: DayMenu[]; skippedDays?: Set<number>; mealDiners?: Record<Meal, number>[] } = {},
): DayMenu[] {
  if (fixed.length === 0) return days
  return days.map((day, i) => {
    if (opts.skippedDays?.has(i)) return day
    const out: DayMenu = { ...day }
    for (const f of fixed) {
      if (!fixedMealFor(fixed, i, f.meal)) continue
      const locked = opts.lockedSlots?.[String(i)]?.[f.meal] && opts.existingDays?.[i]?.[f.meal]
      if (locked) {
        out[f.meal] = opts.existingDays![i][f.meal]
        continue
      }
      const diners = opts.mealDiners?.[i]?.[f.meal as Meal]
      out[f.meal] = {
        ...(diners && diners > 0 ? { servings: diners } : {}),
        dishes: [{ kind: 'note', text: fixedNoteText(f), fixed: { items: f.items.map((x) => ({ ...x })) } }],
      }
    }
    return out
  })
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
 * PRO-238 (2026-10-19): the main protein of a dish for the "not the same at
 * lunch and dinner" rule — `proteinKind` from tasteDeck.ts (carne, pescado,
 * legumbre, huevo); «verdura» is no protein and never blocks. The test
 * households got «lentejas estofadas» for lunch and «lentejas guisadas» for
 * dinner the same Sunday (two recipes, so `usedRecipeIds` let it through).
 */
export function mainProteinOf(recipe: Pick<RecipeWithIngredients, 'name' | 'ingredients'>): string | null {
  const kind = proteinKind({ name: recipe.name, ingredients: recipe.ingredients ?? [] })
  return kind === 'verdura' ? null : kind
}

/**
 * Build a random menu for one iteration.
 */
/** Exported for tests (restrictions over the full catalogue, PRO-61). */
export function buildRandomMenu(
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
  timeBudgetByDay?: Record<number, DayTimeBudget>,
  mealDiners?: Record<Meal, number>[],
  mealDishCounts?: MealDishCounts,
  likedRecipeIds?: Set<string>,
  /** PRO-224: day index → the group the kids ate at school; that dinner avoids it. */
  dinnerAvoidGroups?: Record<number, FoodGroup>,
  unavailableEquipment?: Set<string>,
): { days: DayMenu[]; warnings: string[] } {
  const usedRecipeIds = new Set<string>()
  const days: DayMenu[] = []
  const warnings: string[] = []
  const proteinById = new Map<string, string | null>()
  let recipeById: Map<string, RecipeWithCourse> | null = null
  const proteinOfId = (id: string): string | null => {
    if (!proteinById.has(id)) {
      recipeById ??= new Map(allRecipes.map((x) => [x.id, x]))
      const r = recipeById.get(id)
      proteinById.set(id, r ? mainProteinOf(r) : null)
    }
    return proteinById.get(id) ?? null
  }

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

    // Main proteins already in this day's lunch / dinner (PRO-238), locked
    // slots included, so the other one picks a different protein when it can.
    const dayProteins = new Map<string, Set<string>>()
    const noteProteins = (meal: string, dishes: readonly Dish[] | undefined) => {
      if (meal !== 'lunch' && meal !== 'dinner') return
      for (const d of dishes ?? []) {
        if (d.kind !== 'recipe' || ((d as RecipeDish).course != null && (d as RecipeDish).course !== 'main')) continue
        const k = proteinOfId(d.recipeId)
        if (k) (dayProteins.get(meal) ?? dayProteins.set(meal, new Set()).get(meal)!).add(k)
      }
    }
    for (const meal of Object.keys(dayTemplate)) {
      if (dayTemplate[meal] && existingDays && lockedSlots[String(dayIndex)]?.[meal] && existingDays[dayIndex]?.[meal]) {
        noteProteins(meal, existingDays[dayIndex][meal]?.dishes)
      }
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

      // Menú del cole (PRO-224): «si comieron lentejas, la cena no es de legumbres».
      const avoidGroup = meal === 'dinner' ? dinnerAvoidGroups?.[dayIndex] : undefined
      const slotPool = avoidGroup ? withoutFoodGroup(allRecipes, avoidGroup) : allRecipes
      const otherMeal = meal === 'lunch' ? 'dinner' : meal === 'dinner' ? 'lunch' : null
      const avoid = otherMeal ? dayProteins.get(otherMeal) : undefined

      for (const course of wantedCourses) {
        // Same main protein as the other meal of the day (PRO-238): only if nothing else fits.
        const pool = avoid?.size && (course === 'main' || course === null)
          ? slotPool.filter((r) => { const k = proteinOfId(r.id); return !k || !avoid.has(k) })
          : slotPool
        const opts = {
          meal: meal as Meal,
          season,
          usedRecipeIds,
          restrictions,
          favoriteRecipeIds,
          likedRecipeIds,
          bannedRecipeIds,
          dayIndex,
          dislikes,
          availableEquipment,
          unavailableEquipment,
          timeBudget: timeBudgetByDay?.[dayIndex] ?? null,
        }
        const picked = (pool !== slotPool ? findForCourse(pool, course, opts) : undefined) ?? findForCourse(slotPool, course, opts)
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

      noteProteins(meal, dishes)

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
 * fitness = ½·calorieDeviation + macro deviations
 *         + 100·QUALITY_WEIGHT·(1 − metabolic quality) + 100·VARIETY_WEIGHT·(1 − plant variety)
 *         + unmappedPenalty
 *
 * The metabolic terms carry Mimoia's opinion (the former kb/10 mandamientos.md: insulin
 * and inflammation over calories, real food with fibre, many different
 * plants a week). See metabolicScore.ts. Calories still count, at half
 * weight, so menus stay sensible for the household's energy needs.
 *
 * Uses cached `recipe.nutritionPerServing` when available; legacy recipes
 * (whose nutrition is null) still score but get a small penalty so the
 * algorithm prefers fully-mapped alternatives.
 */
const CALORIE_WEIGHT = 0.5
export const QUALITY_WEIGHT = 3
export const VARIETY_WEIGHT = 0.5

async function scoreMenu(
  days: DayMenu[],
  targetCalories: number,
  db: any,
  unmappedRecipeIds: Set<string>,
  metabolic: ReadonlyMap<string, MetabolicProfile>,
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

  const { quality01, variety01 } = menuMetabolicQuality(days, metabolic)

  return (
    CALORIE_WEIGHT * calorieDeviation +
    carbsDeviation +
    fatDeviation +
    proteinDeviation +
    // Deviations are in percentage points, so the 0..1 metabolic terms are
    // scaled to points too: a menu 20 points worse in quality costs as much
    // as a macro 20 % off target.
    QUALITY_WEIGHT * 100 * (1 - quality01) +
    VARIETY_WEIGHT * 100 * (1 - variety01) +
    unmappedPenalty
  )
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
  weekPlan?: WeekPlan,
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
  // Comidas fijas (PRO-218): those slots are not generated; they are put back
  // as «Fijo: …» at the end (withFixedMeals). The fixed list lives in the
  // saved settings blob even when a custom template is passed.
  const fixedMeals = fixedMealsFromTemplate(settings?.template)
  // Per-slot diner counts (only present when the profile's plantilla uses the
  // numeric shape `{ [day]: { [meal]: number } }`). Slots that didn't carry an
  // explicit count keep `servings` undefined and fall back to the household
  // multiplier in the shopping-list aggregator.
  // PRO-225: «¿Alguna comida fuera?» / «¿Viene alguien?» shape this week
  // only (copies; the saved plantilla is never written).
  const { template: plannedTemplate, mealDiners } = applyWeekPlan(
    normalizeMealTemplate(rawTemplate) ?? defaultTemplate(),
    extractMealDiners(rawTemplate),
    weekPlan,
    (d, m) => !!(existingDays?.[d]?.[m] && lockedSlots[String(d)]?.[m]),
  )
  const template = templateWithoutFixed(plannedTemplate, fixedMeals)
  // Per-meal-type dish count from the same junk-drawer blob:
  // `{ mealDishCounts: { lunch: 2, dinner: 3 } }`. Absent = all 1-dish.
  const mealDishCounts = extractMealDishCounts(rawTemplate)

  // Fetch all recipes with ingredients
  const allRecipes = await loadMatchableRecipes(userId, db)

  // PRO-229 · «¿Qué te queda en la nevera?»: what was said goes into the
  // despensa (nevera); recipes that use what's in the fridge weigh more.
  // PRO-295: as read by Claude before generating (`prepareFridgeForMenu`).
  await rememberFridge(userId, weekPlan?.fridgeItems, db).catch(() => {})
  const fridgeRecipeIds = recipesUsingFridge(allRecipes, await loadFridgeTerms(userId, db).catch(() => []))

  // Identify recipes whose nutritionPerServing isn't cached yet — they get a
  // tiny fitness penalty so the algorithm prefers fully-mapped alternatives.
  const nutritionRows = await db
    .select({ id: recipes.id, nutritionPerServing: recipes.nutritionPerServing })
    .from(recipes)
    .where(visibleRecipeWhere(await visibleAuthorIds(userId, db)))
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
  const memory = await getMemoryForUser(userId).catch(() => null)
  // PRO-271: and every other member's allergies and diets — the owner's
  // «Generar mi menú» must respect what the person who joined by invitation
  // said (a read error keeps the generating user's own).
  const restrictions = await withHouseholdRestrictions(mergeRestrictions(user.restrictions, memory), userId, db)
  const dislikesValue = memory?.dislikes?.value
  const equipmentValue = memory?.equipment?.value
  // The household's ficha on top (PRO-253): every member's dislikes and
  // equipment missing right now («sin horno hasta nuevo aviso»).
  const { dislikes, availableEquipment, unavailableEquipment } = withFichaFilters(
    {
      dislikes: Array.isArray(dislikesValue) ? (dislikesValue as string[]) : [],
      availableEquipment: Array.isArray(equipmentValue)
        ? new Set<string>((equipmentValue as string[]).map(normaliseEquipment))
        : undefined,
    },
    await loadFichaMenuConstraints(userId, { db }),
  )
  // Per-day time limits (PRO-138): total or hands-on minutes; «Rapidez» /
  // «Cocino poco» without an answer → ≤ 30 min in total Mon–Fri.
  // Festivos (PRO-226): a weekday holiday of the household's comunidad
  // autónoma takes Saturday's limit (usually none).
  const timeBudgetByDay = holidayTimeBudgets(
    weekTimeBudgets(memory?.time_available?.value, user),
    weekStart,
    regionFromMemory(memory?.region?.value),
  ).budgets

  // 5b. Onboarding answers: dishes they love join the favourites weighting;
  // time limits come from weekTimeBudgets (onboardingPreferences.ts).
  for (const id of recipesMatchingDishes(allRecipes, user.favoriteDishes)) favoriteRecipeIds.add(id)
  for (const id of fridgeRecipeIds) favoriteRecipeIds.add(id)

  // 5c. «¿Qué tal?» (PRO-111): 5 stars weigh like a favourite, 1 star never
  // comes out on its own. «Afina tu menú» (PRO-146): «Me encanta» weighs like
  // a favourite, «No para mí» of anyone in the household never comes out,
  // «Me apetece» gets a small extra. Matcher-only sets: the week's vetoes stay as they are.
  const rated = withHouseholdRatings(favoriteRecipeIds, bannedRecipeIds, await loadHouseholdRatingSets(userId, db).catch(() => ({ boost: new Set<string>(), exclude: new Set<string>(), like: new Set<string>() })))

  // 5d. Menú del cole (PRO-224): the dinner of a school day avoids the
  // group of the kids' lunch.
  const dinnerAvoidGroups = await loadSchoolDinnerAvoidGroups(await getPrimaryHouseholdId(userId, db).catch(() => null), weekStart, db)

  // Per-recipe metabolic profile, once (scoreMenu runs every iteration).
  const metabolic = new Map(allRecipes.map((r) => [r.id, recipeMetabolicProfile(r.ingredients.map((i) => i.ingredientName), season)]))

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
      rated.favoriteRecipeIds,
      lockedSlots,
      existingDays,
      rated.bannedRecipeIds,
      skippedDays,
      dislikes,
      availableEquipment,
      timeBudgetByDay,
      mealDiners,
      mealDishCounts,
      rated.likedRecipeIds,
      dinnerAvoidGroups,
      unavailableEquipment,
    )

    // Verify the menu has at least some recipes
    const hasRecipes = candidateDays.some((day) =>
      Object.values(day).some((slot) => (slot?.dishes?.length ?? 0) > 0),
    )
    if (!hasRecipes) continue

    const fitness = await scoreMenu(candidateDays, targetCalories, db, unmappedRecipeIds, metabolic)

    if (fitness < bestFitness) {
      bestFitness = fitness
      bestDays = candidateDays
      bestWarnings = candidateWarnings
    }

    // Early stop if fitness is good enough
    if (bestFitness < MENU_GENERATION.OPTIMAL_FITNESS) break
  }

  // PRO-229: if the draw left out everything that uses the fridge, put one in
  // (first free lunch/dinner it fits, Monday first), with the same matcher rules.
  const withFridge = (days: DayMenu[]) =>
    ensureFridgeRecipe(
      days,
      fridgeRecipeIds,
      (dayIndex, meal, used) =>
        findForCourse(allRecipes.filter((r) => fridgeRecipeIds.has(r.id)), null, {
          meal: meal as Meal,
          season,
          usedRecipeIds: used,
          restrictions,
          favoriteRecipeIds: rated.favoriteRecipeIds,
          likedRecipeIds: rated.likedRecipeIds,
          bannedRecipeIds: rated.bannedRecipeIds,
          dayIndex,
          dislikes,
          availableEquipment,
          timeBudget: timeBudgetByDay?.[dayIndex] ?? null,
        }),
      lockedSlots,
      skippedDays,
    ).days


  // Order: the fridge dish (PRO-229) on the drawn week, then tápers (PRO-223), then fixed meals (PRO-218).
  const fixedOpts = { lockedSlots, existingDays, skippedDays, mealDiners }
  // PRO-223: the plantilla's «días de táper» — that lunch is a táper of the dinner before.
  // Fixed meals (PRO-218) go last, so a fixed slot wins over a táper.
  const finish = (days: DayMenu[]) =>
    withFixedMeals(applyTemplateTapers(withFridge(days), rawTemplate, lockedSlots, skippedDays ?? []), fixedMeals, fixedOpts)

  if (bestDays) {
    return { days: finish(bestDays), warnings: bestWarnings }
  }

  const fallback = buildRandomMenu(
    template,
    allRecipes,
    season,
    restrictions,
    rated.favoriteRecipeIds,
    lockedSlots,
    existingDays,
    rated.bannedRecipeIds,
    skippedDays,
    dislikes,
    availableEquipment,
    timeBudgetByDay,
    mealDiners,
    mealDishCounts,
    rated.likedRecipeIds,
    dinnerAvoidGroups,
    unavailableEquipment,
  )
  return { days: finish(fallback.days), warnings: fallback.warnings }
}
