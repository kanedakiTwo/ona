/**
 * Recipe scaler — pure function that scales a recipe's ingredients to a
 * different serving count, applying culinary-friendly rounding bands.
 *
 * Used by:
 *   - GET /recipes/:id?servings=N (server-side scaling for the detail view)
 *   - the menu generator when sizing recipes to the household
 *   - the shopping list aggregator
 *
 * The scaler is **pure**: same inputs → same outputs, no Date.now, no
 * Math.random, no I/O, no DB. Performance budget: a 30-ingredient recipe
 * scales in well under 1 ms (see specs/recipes.md "Quantity Scaling").
 *
 * Step `ingredientRefs` are uuids, not quantities, so the scaler does not
 * touch step rows — the UI computes per-step display from the scaled
 * `ingredients[]`.
 */

import type { Recipe, RecipeIngredient, Unit } from '@ona/shared'

// ─── Public types ────────────────────────────────────────────────

export type ScaledIngredient = RecipeIngredient & {
  /** Original quantity at recipe.servings */
  originalQuantity: number
  /** True when the rounded value differs meaningfully from the exact value */
  rounded: boolean
  /** Optional human-readable explanation for the UI when rounding loses precision */
  roundingNote?: string
}

export type ScaledRecipe = Omit<Recipe, 'ingredients'> & {
  ingredients: ScaledIngredient[]
  /** The factor that was applied: target / recipe.servings */
  scaleFactor: number
  /** Original servings the recipe was authored at */
  scaledFrom: number
  /** Target servings */
  servings: number
}

// ─── Rounding bands for g / ml ───────────────────────────────────

/**
 * Pairs of [upper-bound (exclusive), step]. The first band whose upper
 * bound is greater than `value` wins. The last band has Infinity.
 *
 * Picked to match Spanish kitchen ergonomics: a measuring spoon at the
 * low end, the kitchen scale at the mid range, and bulk-pack rounding
 * for the larger quantities.
 */
const MASS_VOLUME_BANDS: ReadonlyArray<readonly [number, number]> = [
  [5, 0.5],
  [25, 1],
  [100, 5],
  [250, 25],
  [500, 50],
  [1000, 100],
  [5000, 250],
  [Infinity, 500],
]

function bandStep(value: number): number {
  for (const [upper, step] of MASS_VOLUME_BANDS) {
    if (value < upper) return step
  }
  // Unreachable (last band is Infinity), but keep TS happy.
  return 500
}

/** Round `value` to the nearest multiple of `step`. */
function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}

// Units that the scaler treats as "do not scale".
const NON_SCALING: ReadonlySet<Unit> = new Set<Unit>(['pizca', 'al_gusto'])

// ─── Helpers ─────────────────────────────────────────────────────

/** Format a number for the user-facing rounding note. Trims trailing zeros. */
function fmt(n: number): string {
  // Up to 2 decimals, but no trailing zeros (1.50 → "1.5", 2.00 → "2").
  const s = n.toFixed(2)
  return s.replace(/\.?0+$/, '')
}

/**
 * The rounded value differs from `raw` by at least 1 % of `raw` (in
 * absolute terms). Used to suppress noise on values that already lie on
 * a band boundary.
 */
function differsMeaningfully(raw: number, rounded: number): boolean {
  if (raw === 0) return rounded !== 0
  return Math.abs(rounded - raw) / Math.abs(raw) >= 0.01
}

// ─── Per-unit rounding ──────────────────────────────────────────

interface RoundResult {
  quantity: number
  rounded: boolean
  roundingNote?: string
}

function roundForUnit(raw: number, unit: Unit): RoundResult {
  // Zero stays zero — no rounding artefact.
  if (raw === 0) return { quantity: 0, rounded: false }

  // Caller pre-empts these by preserving the original quantity, but defend
  // here too so the function is total.
  if (unit === 'pizca' || unit === 'al_gusto') {
    return { quantity: raw, rounded: false }
  }

  if (unit === 'u') {
    let q = Math.round(raw)
    // A recipe that calls for an ingredient should never end up with 0 of it.
    if (q < 1) q = 1
    if (q !== raw) {
      return {
        quantity: q,
        rounded: true,
        roundingNote: `${fmt(raw)} → redondea a ${fmt(q)}`,
      }
    }
    return { quantity: q, rounded: false }
  }

  if (unit === 'cda' || unit === 'cdita') {
    const q = roundToStep(raw, 0.5)
    return { quantity: q, rounded: differsMeaningfully(raw, q) }
  }

  if (unit === 'g' || unit === 'ml') {
    const step = bandStep(raw)
    const q = roundToStep(raw, step)
    return { quantity: q, rounded: differsMeaningfully(raw, q) }
  }

  // Exhaustive — every Unit branch above returns. If a new unit is added
  // to `@ona/shared` we want the type-checker to flag this.
  const _exhaustive: never = unit
  return { quantity: raw, rounded: false }
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Scale `recipe` to `targetServings` diners.
 *
 * Throws on data-integrity bugs (servings ≤ 0, missing servings, target ≤ 0,
 * negative ingredient quantity). Returns a faithful pass-through if
 * `targetServings === recipe.servings` so callers can use the result
 * uniformly without branching.
 */
export function scaleRecipe(recipe: Recipe, targetServings: number): ScaledRecipe {
  if (recipe.servings == null || !Number.isFinite(recipe.servings) || recipe.servings <= 0) {
    throw new Error(
      `scaleRecipe: recipe.servings must be a positive finite number (got ${String(recipe.servings)})`,
    )
  }
  if (!Number.isFinite(targetServings) || targetServings <= 0) {
    throw new Error(
      `scaleRecipe: targetServings must be a positive finite number (got ${String(targetServings)})`,
    )
  }

  const ingredients = recipe.ingredients ?? []
  for (const ing of ingredients) {
    if (!Number.isFinite(ing.quantity) || ing.quantity < 0) {
      throw new Error(
        `scaleRecipe: ingredient quantity must be a non-negative finite number (got ${String(ing.quantity)} for ${ing.id})`,
      )
    }
  }

  // Fast pass-through: no rounding flags, no notes, scaleFactor 1.
  if (targetServings === recipe.servings) {
    return {
      ...recipe,
      ingredients: ingredients.map(ing => ({
        ...ing,
        originalQuantity: ing.quantity,
        rounded: false,
      })),
      scaleFactor: 1,
      scaledFrom: recipe.servings,
      servings: recipe.servings,
    }
  }

  const factor = targetServings / recipe.servings
  const scaled: ScaledIngredient[] = ingredients.map(ing => {
    if (NON_SCALING.has(ing.unit)) {
      // pizca / al_gusto: preserve the original quantity verbatim.
      return {
        ...ing,
        originalQuantity: ing.quantity,
        rounded: false,
      }
    }
    const raw = ing.quantity * factor
    const result = roundForUnit(raw, ing.unit)
    return {
      ...ing,
      quantity: result.quantity,
      originalQuantity: ing.quantity,
      rounded: result.rounded,
      ...(result.roundingNote ? { roundingNote: result.roundingNote } : {}),
    }
  })

  return {
    ...recipe,
    ingredients: scaled,
    scaleFactor: factor,
    scaledFrom: recipe.servings,
    servings: targetServings,
  }
}
