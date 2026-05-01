/**
 * Barrel exports for the nutrition module.
 *
 * Currently re-exports the USDA FoodData Central client. Task 6 will add
 * the per-recipe nutrition aggregator alongside it.
 */

export {
  createUsdaClient,
  UsdaError,
  type UsdaClient,
  type UsdaNutrientProfile,
  type UsdaSearchResult,
} from './usdaClient.js'
