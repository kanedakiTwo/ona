/**
 * Barrel exports for the nutrition module.
 *
 * - `usdaClient.ts` — USDA FoodData Central HTTP client (Task 5)
 * - `aggregate.ts`  — per-recipe nutrition aggregator (Task 6)
 * - `allergens.ts`  — allergen union + name-based inference (Task 6)
 */

export {
  createUsdaClient,
  UsdaError,
  type UsdaClient,
  type UsdaNutrientProfile,
  type UsdaSearchResult,
} from './usdaClient.js'

export {
  aggregateNutrition,
  type AggregateInput,
  type AggregateResult,
  type IngredientCatalogEntry,
  type SkippedIngredient,
  type SkippedReason,
} from './aggregate.js'

export {
  ALLERGEN_TAGS,
  allergenUnion,
  inferAllergenTagsFromName,
  type AllergenTag,
} from './allergens.js'
