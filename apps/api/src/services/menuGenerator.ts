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
  isBaseRecipe,
} from '@ona/shared'
import type { DayMenu, DayTemplate, DayTimeBudget, Meal, Season, Sex, ActivityLevel, LockedSlots, WeekPlan } from '@ona/shared'
import { applyWeekPlan } from './weekPlan.js'
import { ensureFridgeRecipe, loadFridgeTerms, recipesUsingFridge, rememberFridge } from './fridgeBoost.js'
import { findRecipeForSlot, normaliseEquipment, type RecipeWithIngredients } from './recipeMatcher.js'
import { findForCourse } from './courseAwareMatcher.js'
import { proteinKind } from './tasteDeck.js'
import { dishCountFor, coursesFor } from './menuDishes.js'
import { getMemoryForUser } from './userMemoryStore.js'
import { loadFichaMenuConstraints, withFichaFilters } from './profile/reader.js'
import { memoryTastes, type MenuTastes } from './menuTastes.js'
import { compileRestrictions } from './dietaryRestrictions.js'
import { applyWeekTypeTapers, writtenDishBreaks, dishTypeNote, markWeekTypeConflicts, missingDishTypes, planWeekType, presetRecipeIds, presetSlots, slotKey, weekTypeFromTemplate, type DishSpec } from './weekTypePlan.js'
import { loadWeekTypeForUser } from './weekType.js'
import { recordCatalogWish } from './catalogWishes.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'
import { resolveScope, scopeWhere } from './scopeResolver.js'
import { calculateRecipeCaloriesFromDB, calculateMenuCaloriesFromDB } from './calorieCalculator.js'
import { calculateMenuNutrientsFromDB } from './nutrientCalculator.js'
import type { MealDishCounts, Dish, RecipeDish, Course, FoodGroup } from '@ona/shared'
import { dishTypeInfo } from '@ona/shared'
import { loadSchoolDinnerAvoidGroups, withoutFoodGroup } from './schoolMenu.js'

export { defaultTemplate, normalizeMealTemplate, extractMealDiners, extractMealDishCounts } from './legacyPlantilla.js'

/** Slots of the template that `locks` marks (the week type's preset ones). */
function countLocked(template: DayTemplate[], locks: LockedSlots): number {
  let n = 0
  template.forEach((day, d) => { for (const meal of Object.keys(day)) if (day[meal] && locks[String(d)]?.[meal]) n++ })
  return n
}

/** Two sets of locked slots as one. */
function mergeLocks(a: LockedSlots, b: LockedSlots): LockedSlots {
  const out: LockedSlots = { ...a }
  for (const [d, meals] of Object.entries(b)) out[d] = { ...(out[d] ?? {}), ...meals }
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
  /** Per meal, or per day and meal (the week type's slots). */
  mealDishCounts?: MealDishCounts | MealDishCounts[],
  likedRecipeIds?: Set<string>,
  /** PRO-224: day index → the group the kids ate at school; that dinner avoids it. */
  dinnerAvoidGroups?: Record<number, FoodGroup>,
  unavailableEquipment?: Set<string>,
  /**
   * PRO-377 · «Rehacer la semana con mis favoritas»: every dish comes from
   * these recipes while one fits; a dish none fits takes the catalogue and
   * counts in `favoritesShort`.
   */
  onlyFavoriteIds?: ReadonlySet<string>,
  /**
   * «Semana tipo» (D-182): per slot (`${day}:${meal}`), one spec per dish —
   * a dish type (only recipes of that type), a preset dish (a concrete
   * recipe, something fixed) or free. Slots without one draw as before.
   */
  slotSpecs?: Record<string, DishSpec[]>,
  /** PRO-1201: the ficha's cuisines and cooking level, weights of every draw. */
  tastes?: MenuTastes,
): { days: DayMenu[]; warnings: string[]; favoritesShort: number } {
  // PRO-373: a base (sofrito, verduras asadas…) is never a dish of the menu,
  // whatever pool the caller passes (`loadMatchableRecipes` already drops them).
  if (allRecipes.some((r) => isBaseRecipe(r))) allRecipes = allRecipes.filter((r) => !isBaseRecipe(r))
  const usedRecipeIds = new Set<string>()
  const days: DayMenu[] = []
  const warnings: string[] = []
  let favoritesShort = 0
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

  // «Semana tipo» (D-182): the dishes the week type asks for are chosen
  // first, for the whole week, so a free slot earlier in the week never takes
  // the only ceviche Thursday asked for. Free positions stay for the draw.
  const prefilled = new Map<string, (Dish | undefined)[]>()
  // A type with no recipe that fits, drawn free there: that dish says so (PRO-1186).
  const missingType = new Map<string, Map<number, string>>()
  let rules: ReturnType<typeof compileRestrictions> | null = null
  for (const [key, specs] of Object.entries(slotSpecs ?? {})) {
    const [d, meal] = key.split(':')
    const dayIndex = Number(d)
    if (!template[dayIndex]?.[meal] || skippedDays?.has(dayIndex)) continue
    if (existingDays && lockedSlots[d]?.[meal] && existingDays[dayIndex]?.[meal]) continue
    const avoidGroup = meal === 'dinner' ? dinnerAvoidGroups?.[dayIndex] : undefined
    const slotPool = avoidGroup ? withoutFoodGroup(allRecipes, avoidGroup) : allRecipes
    prefilled.set(key, specs.map((spec, position) => {
      if (spec.kind === 'preset') {
        if (spec.dish.kind === 'recipe') usedRecipeIds.add(spec.dish.recipeId)
        return { ...spec.dish } as Dish
      }
      if (spec.kind !== 'type') return undefined
      // Only recipes of that type, with every filter as usual (the school menu too).
      const typed = slotPool.filter((r) => r.dishTypes?.includes(spec.type))
      const tries = onlyFavoriteIds ? [typed.filter((r) => onlyFavoriteIds.has(r.id)), typed] : [typed]
      const opts = { meal: meal as Meal, season, usedRecipeIds, restrictions, favoriteRecipeIds, likedRecipeIds, bannedRecipeIds, dayIndex, dislikes, availableEquipment, unavailableEquipment, tastes, timeBudget: timeBudgetByDay?.[dayIndex] ?? null }
      let picked: RecipeWithCourse | undefined
      for (const p of tries) if ((picked = findForCourse(p, null, opts) as RecipeWithCourse | undefined)) break
      if (picked) {
        if (onlyFavoriteIds && !onlyFavoriteIds.has(picked.id)) favoritesShort++
        usedRecipeIds.add(picked.id)
        return { kind: 'recipe', recipeId: picked.id, recipeName: picked.name, course: picked.course ?? null, fromWeekType: { type: spec.type } } as RecipeDish
      }
      warnings.push(`dish_type_missing_${spec.type}_${meal}_d${dayIndex}`)
      // A dish (Pizza, Ceviche…) is written by its name — unless the name
      // itself breaks an allergy or diet; a broad type (Carne, Indio…) is drawn free.
      const note = dishTypeNote(spec.type)
      if (dishTypeInfo(spec.type)?.kind === 'broad' || (note.kind === 'note' && writtenDishBreaks(note.text, (rules ??= compileRestrictions(restrictions))))) {
        ;(missingType.get(key) ?? missingType.set(key, new Map()).get(key)!).set(position, spec.type)
        return undefined
      }
      return { ...note, fromWeekType: { type: spec.type, missing: true } } as Dish
    }))
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

      const dayCounts = Array.isArray(mealDishCounts) ? mealDishCounts[dayIndex] : mealDishCounts
      const specs = slotSpecs?.[slotKey(dayIndex, meal)]
      const wantedCount = dishCountFor(meal as Meal, dayCounts ?? {})
      // With specs: a type and the free dishes of options together ask for no
      // course; the other free dishes keep the meal's courses.
      const wantedCourses: (Course | null)[] = specs
        ? specs.map((sp, k) => (sp.kind === 'type' || (sp.kind === 'free' && sp.anyCourse) || specs.length > 3 ? null : coursesFor(specs.length as 1 | 2 | 3)[k]))
        : coursesFor(wantedCount)
      const dishes: Dish[] = []

      // Menú del cole (PRO-224): «si comieron lentejas, la cena no es de legumbres».
      const avoidGroup = meal === 'dinner' ? dinnerAvoidGroups?.[dayIndex] : undefined
      const slotPool = avoidGroup ? withoutFoodGroup(allRecipes, avoidGroup) : allRecipes
      const otherMeal = meal === 'lunch' ? 'dinner' : meal === 'dinner' ? 'lunch' : null
      const avoid = otherMeal ? dayProteins.get(otherMeal) : undefined

      for (let k = 0; k < wantedCourses.length; k++) {
        const course = wantedCourses[k]
        // «Semana tipo»: a dish already chosen before the draw (its type, a
        // concrete recipe, something fixed) goes in as it is.
        const chosen = prefilled.get(slotKey(dayIndex, meal))?.[k]
        if (chosen) {
          dishes.push(chosen)
          continue
        }
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
          tastes,
          timeBudget: timeBudgetByDay?.[dayIndex] ?? null,
        }
        // Favourites first (PRO-377), even over the protein rule, which only
        // asks for another protein when there is one.
        const pools = pool !== slotPool ? [pool, slotPool] : [slotPool]
        const tries = onlyFavoriteIds ? [...pools.map((p) => p.filter((r) => onlyFavoriteIds.has(r.id))), ...pools] : pools
        let picked: RecipeWithCourse | undefined
        for (const p of tries) if ((picked = findForCourse(p, course, opts) as RecipeWithCourse | undefined)) break
        if (picked && onlyFavoriteIds && !onlyFavoriteIds.has(picked.id)) favoritesShort++
        if (!picked) {
          warnings.push(`no_${course ?? 'main'}_available_${meal}_d${dayIndex}`)
          continue
        }
        usedRecipeIds.add(picked.id)
        const missing = missingType.get(slotKey(dayIndex, meal))?.get(k)
        dishes.push({
          kind: 'recipe',
          recipeId: picked.id,
          recipeName: picked.name,
          course: (picked as RecipeWithCourse).course ?? null,
          ...(missing ? { fromWeekType: { type: missing, missing: true } } : {}),
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

  return { days, warnings, favoritesShort }
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
  /** PRO-377: `onlyFavorites` — the week out of the household's favourites. */
  options: { onlyFavorites?: boolean } = {},
): Promise<{ days: DayMenu[]; warnings: string[]; favoritesShort?: number }> {
  // 1. Fetch user profile
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new Error('User not found')

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
  // PRO-377: only the starred ones (not the boosts added below).
  const onlyFavoriteIds = options.onlyFavorites ? new Set(favoriteRecipeIds) : undefined

  // 2. Calculate target calories
  const sex = (user.sex as Sex) ?? 'male'
  const weight = user.weight ?? 70
  const height = user.height ?? 170
  const age = user.age ?? 30
  const activity = (user.activityLevel as ActivityLevel) ?? 'none'
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
  // equipment missing right now («sin horno hasta nuevo aviso»); the
  // cuisines they like and the cook's level weigh the draw (PRO-1201).
  const ficha = await loadFichaMenuConstraints(userId, { db })
  const { dislikes, availableEquipment, unavailableEquipment, tastes } = withFichaFilters(
    {
      dislikes: Array.isArray(dislikesValue) ? (dislikesValue as string[]) : [],
      availableEquipment: Array.isArray(equipmentValue)
        ? new Set<string>((equipmentValue as string[]).map(normaliseEquipment))
        : undefined,
      tastes: memoryTastes(memory),
    },
    ficha,
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

  // «Semana tipo» (D-182): the household's usual week, whoever generates
  // (before, each person's own plantilla). `customTemplate` (tests, tools)
  // is a plain on/off plantilla with no options.
  const weekType = customTemplate
    ? { householdId: null as string | null, days: weekTypeFromTemplate(customTemplate) }
    : await loadWeekTypeForUser(userId, db)
  const householdId = weekType.householdId ?? (await getPrimaryHouseholdId(userId, db).catch(() => null))

  // 5d. Menú del cole (PRO-224): the dinner of a school day avoids the
  // group of the kids' lunch.
  const dinnerAvoidGroups = await loadSchoolDinnerAvoidGroups(householdId, weekStart, db)

  // §5: what each slot asks for this week (the turn's option, or all of them
  // together); a concrete recipe goes through the allergy and diet check.
  const plan = planWeekType(weekType.days, weekStart, { recipes: allRecipes, restrictions, bannedRecipeIds: rated.bannedRecipeIds })
  // PRO-225: «¿Alguna comida fuera?» / «¿Viene alguien?» shape this week
  // only (copies; the week type is never written).
  const { template, mealDiners } = applyWeekPlan(
    plan.template,
    plan.mealDiners,
    weekPlan,
    (d, m) => !!(existingDays?.[d]?.[m] && lockedSlots[String(d)]?.[m]),
  )
  // A concrete recipe of the week type doesn't come out again elsewhere in the week.
  const fixedRecipeIds = presetRecipeIds(plan.specs)
  const drawPool = fixedRecipeIds.size ? allRecipes.filter((r) => !fixedRecipeIds.has(r.id)) : allRecipes
  // Slots whose every dish is preset (something fixed, a concrete recipe)
  // don't count for the calorie target, as the fixed meals didn't before.
  const presets = presetSlots(plan.specs)
  const targetCalories = calculateMenuTargetCalories(sex, weight, height, age, activity, countMealSlots(template) - countLocked(template, presets))

  // Per-recipe metabolic profile, once (scoreMenu runs every iteration).
  const metabolic = new Map(allRecipes.map((r) => [r.id, recipeMetabolicProfile(r.ingredients.map((i) => i.ingredientName), season)]))

  // 6. Iterative optimization
  let bestDays: DayMenu[] | null = null
  let bestFitness: number = MENU_GENERATION.MIN_FITNESS
  let bestWarnings: string[] = []
  let bestShort = Infinity

  for (let i = 0; i < MENU_GENERATION.MAX_ITERATIONS; i++) {
    const { days: candidateDays, warnings: candidateWarnings, favoritesShort: candidateShort } = buildRandomMenu(
      template,
      drawPool,
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
      plan.dishCounts,
      rated.likedRecipeIds,
      dinnerAvoidGroups,
      unavailableEquipment,
      onlyFavoriteIds,
      plan.specs,
      tastes,
    )

    // Verify the menu has at least some recipes
    const hasRecipes = candidateDays.some((day) =>
      Object.values(day).some((slot) => (slot?.dishes?.length ?? 0) > 0),
    )
    if (!hasRecipes) continue

    const fitness = await scoreMenu(candidateDays, targetCalories, db, unmappedRecipeIds, metabolic)

    // PRO-377: with «mis favoritas», fewer dishes from outside them wins first.
    if (fitness < MENU_GENERATION.MIN_FITNESS && (candidateShort < bestShort || (candidateShort === bestShort && fitness < bestFitness))) {
      bestFitness = fitness
      bestDays = candidateDays
      bestWarnings = candidateWarnings
      bestShort = candidateShort
    }

    // Early stop if fitness is good enough
    if (bestFitness < MENU_GENERATION.OPTIMAL_FITNESS) break
  }

  // Preset slots (the week type's) are never where the fridge dish goes.
  const fridgeLocks = mergeLocks(lockedSlots, presets)
  // PRO-229: if the draw left out everything that uses the fridge, put one in
  // (first free lunch/dinner it fits, Monday first), with the same matcher rules.
  // Not with «mis favoritas» (PRO-377): it would swap a favourite out.
  const withFridge = (days: DayMenu[]) =>
    onlyFavoriteIds ? days : ensureFridgeRecipe(
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
          tastes,
          timeBudget: timeBudgetByDay?.[dayIndex] ?? null,
        }),
      fridgeLocks,
      skippedDays,
    ).days


  // Order: the fridge dish (PRO-229) on the drawn week (never on a preset
  // slot), then the «En lugar de …» of a concrete recipe that breaks a
  // restriction, then the week type's tápers (PRO-223).
  const finish = (days: DayMenu[]) =>
    applyWeekTypeTapers(markWeekTypeConflicts(withFridge(days), plan.conflicts), plan.tapers, { locked: lockedSlots, skippedDays, template })

  // A dish type with no recipe that fits goes to Cocina's wishes (best effort).
  const wishes = (warnings: string[]) => {
    for (const type of missingDishTypes(warnings)) {
      recordCatalogWish({ dish: dishTypeInfo(type)?.label ?? type, source: 'mimo', userId, householdId }).catch(() => {})
    }
  }

  // PRO-377: dishes of the generated slots not from the favourites (a táper
  // repeats the dinner before; locked slots were not generated).
  const withShort = (out: { days: DayMenu[]; warnings: string[] }) =>
    onlyFavoriteIds ? { ...out, favoritesShort: countOutsideFavorites(out.days, onlyFavoriteIds, lockedSlots) } : out

  if (bestDays) {
    wishes(bestWarnings)
    return withShort({ days: finish(bestDays), warnings: [...plan.warnings, ...bestWarnings] })
  }

  const fallback = buildRandomMenu(
    template,
    drawPool,
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
    plan.dishCounts,
    rated.likedRecipeIds,
    dinnerAvoidGroups,
    unavailableEquipment,
    onlyFavoriteIds,
    plan.specs,
    tastes,
  )
  wishes(fallback.warnings)
  return withShort({ days: finish(fallback.days), warnings: [...plan.warnings, ...fallback.warnings] })
}

/** PRO-377: recipe dishes outside the favourites, locked slots, tápers and the ficha's fixed dishes (PRO-1141) left out. */
export function countOutsideFavorites(days: DayMenu[], favoriteIds: ReadonlySet<string>, lockedSlots: LockedSlots = {}): number {
  let n = 0
  days.forEach((day, dayIndex) => {
    for (const [meal, slot] of Object.entries(day ?? {})) {
      if (lockedSlots[String(dayIndex)]?.[meal]) continue
      for (const d of slot?.dishes ?? []) {
        if (d.kind === 'recipe' && !(d as RecipeDish).leftoverOf && !d.fixedDish && !favoriteIds.has(d.recipeId)) n++
      }
    }
  })
  return n
}
