/**
 * Recipe-level nutrition aggregator.
 *
 * Pure function: takes a recipe's ingredients (with quantity + unit), an
 * ingredient catalog keyed by ingredientId, and a serving count; returns
 * the per-serving nutrition profile plus a list of ingredients that had
 * to be skipped (no DB row, no density, etc.).
 *
 * Caller responsibilities:
 *   - Build the catalog Map from the DB once per request, then reuse for
 *     every recipe in the request.
 *   - Treat `skipped` as a soft warning surface — the lint pipeline
 *     decides whether a warning blocks save.
 *
 * No I/O, no async, no logging — runs synchronously inside HTTP handlers
 * and the seed script.
 *
 * Spec: ../../../../../specs/nutrition.md ("Recipe Aggregation")
 */

import type { NutritionPerServing, RecipeIngredient } from '@ona/shared'

// ─── Types ──────────────────────────────────────────────────────

export type IngredientCatalogEntry = {
  id: string
  name: string
  /** kcal per 100 g */
  calories: number
  /** g per 100 g */
  protein: number
  /** g per 100 g */
  carbs: number
  /** g per 100 g */
  fat: number
  /** g per 100 g */
  fiber: number
  /** g per 100 g */
  salt: number
  /** g per ml — null/undefined if unmappable (e.g. dry powders without a
   * confident bulk density). */
  density?: number | null
  /** g per unit — null/undefined if not unit-buyable (e.g. flour). */
  unitWeight?: number | null
}

export type AggregateInput = {
  servings: number
  ingredients: Array<RecipeIngredient & { quantity: number }>
  /** Keyed by ingredientId for O(1) lookup. */
  catalog: Map<string, IngredientCatalogEntry>
}

export type SkippedReason =
  | 'no-density'
  | 'no-unit-weight'
  | 'unmapped'
  | 'unsupported-unit'

export type SkippedIngredient = {
  ingredientId: string
  reason: SkippedReason
}

export type AggregateResult = {
  perServing: NutritionPerServing
  skipped: SkippedIngredient[]
}

// ─── Constants ──────────────────────────────────────────────────

/** Volume of 1 cucharada (tablespoon) in ml. */
const CDA_ML = 15
/** Volume of 1 cucharadita (teaspoon) in ml. */
const CDITA_ML = 5

const ZERO_PER_SERVING: NutritionPerServing = {
  kcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  saltG: 0,
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Convert a `RecipeIngredient` quantity to grams using the catalog entry
 * for unit conversions that need density / unitWeight.
 *
 * Returns either:
 *   - `{ grams: number }` for a successful (or negligible) conversion
 *   - `{ skip: SkippedReason }` if the ingredient can't be quantified
 */
function toGrams(
  unit: RecipeIngredient['unit'],
  quantity: number,
  entry: IngredientCatalogEntry,
): { grams: number } | { skip: SkippedReason } {
  switch (unit) {
    case 'g':
      return { grams: quantity }
    case 'ml': {
      if (entry.density == null) return { skip: 'no-density' }
      return { grams: quantity * entry.density }
    }
    case 'u': {
      if (entry.unitWeight == null) return { skip: 'no-unit-weight' }
      return { grams: quantity * entry.unitWeight }
    }
    case 'cda': {
      // If we have a density, convert ml → g. Otherwise default 1 g/ml.
      const grams =
        entry.density != null
          ? quantity * CDA_ML * entry.density
          : quantity * CDA_ML
      return { grams }
    }
    case 'cdita': {
      const grams =
        entry.density != null
          ? quantity * CDITA_ML * entry.density
          : quantity * CDITA_ML
      return { grams }
    }
    case 'pizca':
    case 'al_gusto':
      return { grams: 0 }
    default:
      return { skip: 'unsupported-unit' }
  }
}

/** Round to 1 decimal — kcal is rounded to integer separately. */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// ─── Main entry point ───────────────────────────────────────────

/**
 * Aggregate per-serving nutrition from a recipe's ingredients.
 *
 * - Optional ingredients are INCLUDED (worst-case nutrition per spec).
 * - Catalog misses are skipped with reason `unmapped` (no throw).
 * - `pizca` and `al_gusto` contribute 0 g (negligible).
 * - kcal is rounded to integer; macros to 1 decimal.
 *
 * @throws if `servings <= 0` or not finite.
 */
export function aggregateNutrition(input: AggregateInput): AggregateResult {
  const { servings, ingredients, catalog } = input

  if (!Number.isFinite(servings) || servings <= 0) {
    throw new Error(
      `aggregateNutrition: servings must be a positive finite number; got ${servings}`,
    )
  }

  // Empty recipe → all-zeros, no skips.
  if (ingredients.length === 0) {
    return { perServing: { ...ZERO_PER_SERVING }, skipped: [] }
  }

  let totalKcal = 0
  let totalProtein = 0
  let totalCarbs = 0
  let totalFat = 0
  let totalFiber = 0
  let totalSalt = 0
  const skipped: SkippedIngredient[] = []

  for (const ing of ingredients) {
    const entry = catalog.get(ing.ingredientId)
    if (!entry) {
      skipped.push({ ingredientId: ing.ingredientId, reason: 'unmapped' })
      continue
    }

    const conv = toGrams(ing.unit, ing.quantity, entry)
    if ('skip' in conv) {
      skipped.push({ ingredientId: ing.ingredientId, reason: conv.skip })
      continue
    }

    // Per-100g → grams used.
    const factor = conv.grams / 100
    totalKcal += entry.calories * factor
    totalProtein += entry.protein * factor
    totalCarbs += entry.carbs * factor
    totalFat += entry.fat * factor
    totalFiber += entry.fiber * factor
    totalSalt += entry.salt * factor
  }

  const perServing: NutritionPerServing = {
    kcal: Math.round(totalKcal / servings),
    proteinG: round1(totalProtein / servings),
    carbsG: round1(totalCarbs / servings),
    fatG: round1(totalFat / servings),
    fiberG: round1(totalFiber / servings),
    saltG: round1(totalSalt / servings),
  }

  return { perServing, skipped }
}
