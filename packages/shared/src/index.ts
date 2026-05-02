// Types
export type { User, UserSettings, DayTemplate, OnboardingAnswers } from './types/user.js'
export type { Ingredient } from './types/ingredient.js'
export type {
  Recipe,
  RecipeIngredient,
  RecipeIngredientInput,
  RecipeStep,
  NutritionPerServing,
  CreateRecipeInput,
  UpdateRecipeInput,
  ExtractedRecipe,
  ExtractedIngredient,
} from './types/recipe.js'
export type { Menu, DayMenu, MealSlot, LockedSlots } from './types/menu.js'
export type { ShoppingItem, ShoppingList, BuyableUnit } from './types/shopping.js'
export type { Macros, Vitamins, Minerals, AminoAcids, FatAcids, CarbTypes, NutrientBalance } from './types/nutrition.js'
export type {
  Meal,
  Season,
  ActivityLevel,
  Sex,
  HouseholdSize,
  CookingFrequency,
  Priority,
  Unit,
  Difficulty,
  Aisle,
  SourceType,
} from './constants/enums.js'

// Zod schemas
export { registerSchema, loginSchema, onboardingSchema, updateProfileSchema } from './types/user.js'
export { createIngredientSchema, updateIngredientSchema } from './types/ingredient.js'
export {
  createRecipeSchema,
  updateRecipeSchema,
  recipeIngredientSchema,
  recipeStepSchema,
  nutritionPerServingSchema,
} from './types/recipe.js'
export { generateMenuSchema, lockMealSchema } from './types/menu.js'

// Constants
export {
  MEALS,
  SEASONS,
  ACTIVITY_LEVELS,
  SEXES,
  HOUSEHOLD_SIZES,
  COOKING_FREQUENCIES,
  PRIORITIES,
  HOUSEHOLD_MULTIPLIER,
  UNITS,
  DIFFICULTIES,
  AISLES,
  SOURCE_TYPES,
} from './constants/enums.js'
export { TARGET_MACROS, MACRO_RANGES, ACTIVITY_FACTORS, MENU_GENERATION, EMA_WEIGHTS, MINERALS_RDA, VITAMINS_RDA } from './constants/nutrition.js'
export { ONA_PRINCIPLES } from './constants/philosophy.js'

// Utils
export { calculateBMR, getActivityFactor, calculateTDEE, calculateMenuTargetCalories } from './utils/bmr.js'
export { ingredientCalories, recipeCalories, dayCalories, menuCalories } from './utils/calories.js'
export { ingredientNutrients, sumNutrients, nutrientsToPercentages, updateNutrientBalance, normalizeDeviation } from './utils/nutrients.js'
export { detectSeason, isInSeason } from './utils/seasons.js'
