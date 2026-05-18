/**
 * Cook-from-pantry matcher (PR 12).
 *
 * Given a set of recipes the user could conceivably cook and the household's
 * current pantry, rank by how many of each recipe's *required* ingredients
 * the household already has at home.
 *
 * v1 rule: "we have it" = pantry row exists with quantity > 0 and the
 * matching `ingredient_id`. No unit conversion, no quantity comparison
 * (we already deduct on cook in PR 11 so most users see "enough or not"
 * with a glance). The follow-up will refine this once pantry-quantity
 * data is dense.
 */

import { and, eq, gt, isNotNull } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { ingredients, pantryItems, recipeIngredients, recipes } from '../db/schema.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'

type Db = typeof defaultDb

// ─── pure helpers (unit-tested) ──────────────────────────────────────────

/** Set of ingredient ids the household has at home (quantity > 0). */
export type PantrySet = Set<string>

export interface RecipeIngredientSnapshot {
  ingredientId: string
  ingredientName: string
  /** When true, missing it doesn't pull the score down. */
  optional: boolean
}

export interface RecipeScore {
  coverage: number
  matchedCount: number
  totalRequired: number
  missing: string[]
}

/**
 * Pure scorer. `coverage = matched / totalRequired` with two carve-outs:
 *   - optional ingredients are excluded from both numerator + denominator
 *     (they don't pull the score down)
 *   - when totalRequired = 0 (all optional / empty list), we return 0
 *     to avoid surfacing weird "perfect match" recipes
 */
export function scoreRecipeAgainstPantry(
  ings: RecipeIngredientSnapshot[],
  pantry: PantrySet,
): RecipeScore {
  let matched = 0
  let total = 0
  const missing: string[] = []
  for (const ing of ings) {
    if (ing.optional) continue
    total += 1
    if (pantry.has(ing.ingredientId)) {
      matched += 1
    } else {
      missing.push(ing.ingredientName)
    }
  }
  const coverage = total === 0 ? 0 : matched / total
  return { coverage, matchedCount: matched, totalRequired: total, missing }
}

// ─── DB-backed entry point ───────────────────────────────────────────────

export interface PantryMatchHit {
  recipe: {
    id: string
    name: string
    imageUrl: string | null
    totalTime: number | null
  }
  coverage: number
  matchedCount: number
  totalRequired: number
  missing: string[]
}

/**
 * Rank every catalogue recipe by how much of it the caller's household
 * already has. Returns the top `limit` (default 3) by coverage desc,
 * ties broken by `matchedCount` desc, then `totalRequired` desc (prefers
 * fuller recipes when coverage is tied).
 *
 * Filtered to recipes with at least one required ingredient in the pantry
 * — surfacing 0%-match recipes adds nothing.
 */
export async function findPantryMatches(
  userId: string,
  limit: number = 3,
  db: Db = defaultDb,
): Promise<PantryMatchHit[]> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return []

  // Load the pantry ingredient set in one query.
  const pantryRows = await db
    .select({ ingredientId: pantryItems.ingredientId })
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.householdId, householdId),
        isNotNull(pantryItems.ingredientId),
        gt(pantryItems.quantity, 0),
      ),
    )
  const pantry: PantrySet = new Set(
    pantryRows.map((r) => r.ingredientId).filter((id): id is string => id != null),
  )
  if (pantry.size === 0) return []

  // Pull every recipe's ingredient roster in one join. Filtered to system
  // recipes + the user's own (mirrors the catalogue scope).
  const rows = await db
    .select({
      recipeId: recipes.id,
      recipeName: recipes.name,
      recipeImageUrl: recipes.imageUrl,
      recipeTotalTime: recipes.totalTime,
      ingredientId: recipeIngredients.ingredientId,
      ingredientName: ingredients.name,
      optional: recipeIngredients.optional,
    })
    .from(recipes)
    .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))

  // Group rows by recipe.
  const byRecipe = new Map<
    string,
    {
      meta: { id: string; name: string; imageUrl: string | null; totalTime: number | null }
      ingredients: RecipeIngredientSnapshot[]
    }
  >()
  for (const r of rows) {
    let bucket = byRecipe.get(r.recipeId)
    if (!bucket) {
      bucket = {
        meta: {
          id: r.recipeId,
          name: r.recipeName,
          imageUrl: r.recipeImageUrl ?? null,
          totalTime: r.recipeTotalTime ?? null,
        },
        ingredients: [],
      }
      byRecipe.set(r.recipeId, bucket)
    }
    bucket.ingredients.push({
      ingredientId: r.ingredientId,
      ingredientName: r.ingredientName,
      optional: r.optional,
    })
  }

  // Score each, filter to non-zero matches, sort by coverage desc.
  const scored: PantryMatchHit[] = []
  for (const bucket of byRecipe.values()) {
    const score = scoreRecipeAgainstPantry(bucket.ingredients, pantry)
    if (score.matchedCount === 0) continue
    scored.push({ recipe: bucket.meta, ...score })
  }
  scored.sort((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage - a.coverage
    if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount
    return b.totalRequired - a.totalRequired
  })
  return scored.slice(0, limit)
}
