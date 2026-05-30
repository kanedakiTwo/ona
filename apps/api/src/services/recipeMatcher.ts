import type { FitLevel, Meal, Season } from '@ona/shared'
import { FIT_WEIGHT, isInSeason } from '@ona/shared'

export interface RecipeWithIngredients {
  id: string
  name: string
  meals: string[]
  seasons: string[]
  /**
   * Three-state fit per meal/season. Absent key (or undefined map) means
   * the recipe has only the legacy array tagging — the matcher derives
   * 'perfect' for every entry already in `meals` / `seasons` so existing
   * scoring behaviour is preserved. The numeric weights come from
   * `FIT_WEIGHT` in shared (`mid` = 1, `perfect` = 3).
   */
  mealFit?: Partial<Record<Meal, FitLevel>>
  seasonFit?: Partial<Record<Season, FitLevel>>
  tags: string[]
  /** Equipment the recipe needs ('horno', 'freidora', 'olla express'…). Empty / undefined = no equipment requirement. */
  equipment?: string[]
  /** Prep time in minutes. Used by the time-budget filter (user_memories.time_available). */
  prepTime?: number | null
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
  /**
   * Recipes the user vetoed for this week. The matcher filters them out
   * before season / restriction checks, so a vetoed favourite is still
   * excluded. Absent / empty set is a no-op (existing call sites stay valid).
   */
  bannedRecipeIds?: Set<string>
  /**
   * When set, the matcher only returns recipes whose `tags` include this
   * value. Used by the "Pin meal type to a day" UI (cremas, legumbres,
   * pizza…). Null / absent means no constraint.
   */
  pinnedType?: string | null
  /**
   * Lowercased ingredient names the user dislikes (from user_memories
   * `dislikes`). Functionally identical to `restrictions` — recipes whose
   * ingredient list contains any of these strings are filtered out — but
   * separated so the digest / UI can surface them differently (dislikes
   * are softer than allergens). Empty array / absent is a no-op.
   */
  dislikes?: string[]
  /**
   * Kitchen equipment the user owns (lowercased; from user_memories
   * `equipment`). A recipe is filtered out only when it lists at least
   * one piece of equipment that's NOT in this set. Empty / absent = no
   * filter — useful when the user hasn't completed onboarding yet.
   */
  availableEquipment?: Set<string>
  /**
   * Maximum prep-time minutes allowed for this slot (from user_memories
   * `time_available[weekday]`, looked up by the route). Recipes whose
   * `prepTime` exceeds this are excluded. Null/absent = no filter.
   */
  maxPrepMinutes?: number | null
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
  const {
    meal,
    season,
    usedRecipeIds,
    restrictions,
    bannedRecipeIds,
    pinnedType,
    dislikes,
    availableEquipment,
    maxPrepMinutes,
  } = options

  // Restrictions + dislikes share the same predicate: any ingredient name
  // whose lowercased form contains one of the entries → recipe excluded.
  // Dislikes are merged into the same set so the loop stays one O(N×M).
  const blockedNames = new Set<string>([
    ...restrictions.map((r) => r.toLowerCase()),
    ...(dislikes ?? []).map((d) => d.toLowerCase()),
  ])

  return recipes.filter((recipe) => {
    // 0. Veto wins over everything else — a banned favourite is still out.
    if (bannedRecipeIds?.has(recipe.id)) return false

    // 0b. Pinned meal type — when set, recipe must carry the tag.
    if (pinnedType && !recipe.tags.includes(pinnedType)) return false

    // 1. Meal type match (fit-aware). A recipe passes when:
    //    - it carries a fit map AND the entry for this slot is 'mid' or 'perfect', OR
    //    - it has no fit map (legacy) AND `meals` contains the slot — equivalent to 'perfect'.
    if (mealFitFor(recipe, meal) == null) return false

    // 2. Season match (fit-aware, same shape as the meal check).
    if (recipe.seasonFit) {
      if (!recipe.seasonFit[season]) return false
    } else if (!isInSeason(recipe.seasons as Season[], season)) return false

    // 3. No repeats in the week
    if (usedRecipeIds.has(recipe.id)) return false

    // 4. Restriction + dislikes check — exact-match against the lowercased
    //    ingredient name. Lifted into a single Set above so a user with
    //    both "sin gluten" + dislikes:['cilantro'] pays one pass.
    if (blockedNames.size > 0) {
      const hasBlocked = recipe.ingredients.some((ing) =>
        blockedNames.has(ing.ingredientName.toLowerCase()),
      )
      if (hasBlocked) return false
    }

    // 5. Equipment check — every piece of equipment the recipe needs must
    //    be present in the user's owned set. Recipes with no equipment array
    //    (= no requirement) pass freely. Comparison is case-insensitive and
    //    accent-insensitive so "freidora de aire" matches "Freidora de Aire".
    if (availableEquipment && availableEquipment.size > 0) {
      const required = recipe.equipment ?? []
      const ok = required.every((e) => availableEquipment.has(normaliseEquipment(e)))
      if (!ok) return false
    }

    // 6. Time-budget check — recipe.prepTime must fit the slot's window.
    //    Recipes with no prepTime (data gap) pass freely.
    if (maxPrepMinutes != null && maxPrepMinutes > 0) {
      if (typeof recipe.prepTime === 'number' && recipe.prepTime > maxPrepMinutes) {
        return false
      }
    }

    return true
  })
}

/**
 * Resolve a recipe's fit for a given meal slot. Returns the explicit fit
 * level when present, derives 'perfect' for legacy rows whose `meals`
 * array contains the slot, and null when the recipe shouldn't surface in
 * that slot at all.
 */
export function mealFitFor(
  recipe: RecipeWithIngredients,
  meal: Meal,
): FitLevel | null {
  if (recipe.mealFit) {
    return recipe.mealFit[meal] ?? null
  }
  return recipe.meals.includes(meal) ? 'perfect' : null
}

/** Same as `mealFitFor`, for seasons. */
export function seasonFitFor(
  recipe: RecipeWithIngredients,
  season: Season,
): FitLevel | null {
  if (recipe.seasonFit) {
    return recipe.seasonFit[season] ?? null
  }
  return isInSeason(recipe.seasons as Season[], season) ? 'perfect' : null
}

/**
 * Pick a random recipe from the filtered pool.
 *
 * Weighting (per slot):
 *   - meal fit:   mid = 1×, perfect = 3×.
 *   - season fit: same scale, multiplicative against meal weight.
 *   - favourite:  2× on top.
 *
 * So a perfect-meal / perfect-season favourite weighs 18 against a
 * mid-meal / mid-season non-favourite at 1 — strong but not crushing,
 * matching the user-tested feel of the legacy "favourites get 2× weight"
 * behaviour while letting `mid` fits still appear meaningfully often.
 */
export function pickRandom(
  candidates: RecipeWithIngredients[],
  favoriteRecipeIds: Set<string>,
  ctx?: { meal?: Meal; season?: Season },
): RecipeWithIngredients | undefined {
  if (candidates.length === 0) return undefined

  const pool: RecipeWithIngredients[] = []
  for (const recipe of candidates) {
    let weight = 1
    if (ctx?.meal) {
      const fit = mealFitFor(recipe, ctx.meal)
      if (fit) weight *= FIT_WEIGHT[fit]
    }
    if (ctx?.season) {
      const fit = seasonFitFor(recipe, ctx.season)
      if (fit) weight *= FIT_WEIGHT[fit]
    }
    if (favoriteRecipeIds.has(recipe.id)) weight *= 2
    // Float weights are fine — duplicate the recipe into the pool an
    // integer number of times. Round so the loop terminates cleanly.
    const count = Math.max(1, Math.round(weight))
    for (let i = 0; i < count; i++) pool.push(recipe)
  }

  const index = Math.floor(Math.random() * pool.length)
  return pool[index]
}

/**
 * Find a matching recipe for a meal slot. Returns undefined if none found.
 */
/**
 * Lowercase + strip accents so "Freidora de Aire" matches "freidora de aire"
 * regardless of how the user or the recipe data is normalised. Used to build
 * the set passed in `availableEquipment` and to look up each recipe's
 * `equipment` entries against it.
 */
export function normaliseEquipment(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

export function findRecipeForSlot(
  recipes: RecipeWithIngredients[],
  options: MatcherOptions,
): RecipeWithIngredients | undefined {
  const candidates = matchRecipes(recipes, options)
  return pickRandom(candidates, options.favoriteRecipeIds, {
    meal: options.meal,
    season: options.season,
  })
}
