import type { Meal, Season } from '@ona/shared'
import { isInSeason } from '@ona/shared'

export interface RecipeWithIngredients {
  id: string
  name: string
  meals: string[]
  seasons: string[]
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

    // 1. Meal type match
    if (!recipe.meals.includes(meal)) return false

    // 2. Season match
    if (!isInSeason(recipe.seasons as Season[], season)) return false

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
  return pickRandom(candidates, options.favoriteRecipeIds)
}
