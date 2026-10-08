// Types
export type { User, UserSettings, DayTemplate, OnboardingAnswers, Role } from './types/user.js'
export { ROLES } from './types/user.js'
export type { Ingredient, PrepMethod, PrepRequirement } from './types/ingredient.js'
export { PREP_METHODS, PREP_METHOD_HOURS_BEFORE, prepRequirementSchema } from './types/ingredient.js'
export type {
  Recipe,
  RecipeShoppingIssue,
  RecipeIngredient,
  RecipeIngredientInput,
  RecipeStep,
  NutritionPerServing,
  CreateRecipeInput,
  UpdateRecipeInput,
  ExtractedRecipe,
  ExtractedIngredient,
  IngredientOverride,
  FitLevel,
  MealFitMap,
  SeasonFitMap,
  RecipeFrequency,
  Course,
} from './types/recipe.js'
export type { Menu, DayMenu, MealSlot, LockedSlots, MealDishCounts } from './types/menu.js'
export type { Dish, RecipeDish, NoteDish } from './types/menuDish.js'
export { isRecipeDish, isNoteDish, recipeDishesOf } from './types/menuDish.js'
export type {
  MemoryKey,
  MemorySource,
  MemoryFact,
  UserMemory,
} from './types/userMemory.js'
export {
  MEMORY_KEYS,
  MEMORY_SOURCES,
  MEMORY_VALUE_SCHEMAS,
  validateMemoryFactValue,
  buildMemoryDigestText,
} from './types/userMemory.js'
export type { ShoppingItem, ShoppingList, BuyableUnit } from './types/shopping.js'
export type {
  ShopKind,
  ShopChannel,
  ShopFulfilment,
  ShopOrderStatus,
  EstimateSource,
  LineQuote,
  LineQuoteStatus,
  LineVerdict,
  LineDecision,
  ShopOrderLine,
  QuoteSummary,
  ShopSnapshot,
  ShopOrderLinks,
  ShopOrder,
  Shop,
  ShopInput,
  ShopFormState,
  DeliveryCheck,
} from './types/shopOrders.js'
export {
  SHOP_KINDS,
  SHOP_KIND_LABELS,
  SHOP_CHANNELS,
  SHOP_CHANNEL_LABELS,
  SHOP_FULFILMENTS,
  SHOP_ORDER_STATUSES,
  SHOP_ORDER_STATUS_LABELS,
  EMPTY_SHOP_FORM,
  normalizePhone,
  shopInputSchema,
  buildShopPayload,
  approveShopOrderSchema,
  patchShopOrderSchema,
} from './types/shopOrders.js'
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
  MealTypeTag,
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
  ingredientOverrideSchema,
  fitLevelSchema,
  mealFitMapSchema,
  seasonFitMapSchema,
  FIT_LEVELS,
  FIT_WEIGHT,
  FREQUENCY_LEVELS,
  FREQUENCY_WEIGHT,
  recipeFrequencySchema,
  COURSES,
  COURSE_LABELS,
  courseSchema,
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
  MEAL_TYPE_TAGS,
  MEAL_TYPE_TAG_LABELS,
} from './constants/enums.js'
export { TARGET_MACROS, MACRO_RANGES, ACTIVITY_FACTORS, MENU_GENERATION, EMA_WEIGHTS, MINERALS_RDA, VITAMINS_RDA } from './constants/nutrition.js'
export { ONA_PRINCIPLES } from './constants/philosophy.js'
export { AI_DISCLOSURE, AI_DISCLOSURE_FIRST_PERSON, AI_DISCLOSURE_SHORT } from './constants/aiDisclosure.js'
export { RESTRICTION_PRESETS } from './constants/restrictions.js'
export type { RestrictionPreset } from './constants/restrictions.js'

// Utils
export { calculateBMR, getActivityFactor, calculateTDEE, calculateMenuTargetCalories } from './utils/bmr.js'
export { ingredientCalories, recipeCalories, dayCalories, menuCalories } from './utils/calories.js'
export { ingredientNutrients, sumNutrients, nutrientsToPercentages, updateNutrientBalance, normalizeDeviation } from './utils/nutrients.js'
export { detectSeason, isInSeason } from './utils/seasons.js'
export {
  isCuratedRecipe,
  isAllYearRecipe,
  recipeSeasonBadge,
  recipeMinutes,
  filterCatalogRecipes,
  pickFeaturedRecipes,
} from './utils/catalog.js'
export type { CatalogScope, CatalogRecipeLike, CatalogFilterState } from './utils/catalog.js'
export { menuShareText, recipeSharePayload, withOnaFooter } from './utils/sharePayloads.js'
export type { SharePayload } from './utils/sharePayloads.js'
export {
  householdMultiplier,
  householdToDiners,
  householdSizeToCounts,
  KID_PORTION_FRACTION,
} from './utils/household.js'
export type { HouseholdSnapshot } from './utils/household.js'

export { formatQty, prettyName, capitalize, ingredientDisplayName } from './utils/shopFormat.js'
export { BUY_RULES } from './buy/rules.js'
export type { BuyRule, BuyShop, BuyBy, BuyTier, BuyChoice } from './buy/rules.js'
export { toOrderQty, resolveBuyRule, buyRuleByKey, splitCompound, normalizeBuyName, weightPhrase } from './buy/convert.js'
export type { OrderQty, OrderQtyInput, ResolvedRule } from './buy/convert.js'

export { buildRecipePayload } from './recipeFormPayload.js'
export type { IngredientRowState, RecipeFormState } from './recipeFormPayload.js'

// Units
export { normalizeTerm } from './units/normalize.js'
export { VOCABULARY, getTermBySynonym } from './units/vocabulary.js'
export type { VocabularyTerm, UnitFactor } from './units/vocabulary.js'
export { resolveFromTable } from './units/resolve.js'
export type { ResolveInput, ResolveResult } from './units/resolve.js'
export { formatScaled, formatFraction, formatCanonical, isCulinaryClean } from './units/format.js'
export type { FormatScaledInput, FormatScaledOutput } from './units/format.js'

// In-house error tracker (specs/errors.md)
export {
  CLIENT_ERROR_LIMITS,
  clientErrorReportSchema,
  buildClientErrorReport,
  clientErrorDedupeKey,
  isIgnorableClientError,
} from './types/clientErrors.js'
export type { ClientErrorReport, ClientErrorInput } from './types/clientErrors.js'

// Public brand (D-012) + pre-launch waitlist (specs/waitlist.md)
export { BRAND_NAME, ASSISTANT_NAME, BRAND_SUPPORT_EMAIL } from './constants/brand.js'
export {
  WAITLIST_HOUSEHOLD_SIZES,
  WAITLIST_PLANNER_ROLES,
  WAITLIST_CURRENT_METHODS,
  WAITLIST_PLATFORMS,
  WAITLIST_STATUSES,
  WAITLIST_HOUSEHOLD_SIZE_LABELS,
  WAITLIST_PLANNER_ROLE_LABELS,
  WAITLIST_CURRENT_METHOD_LABELS,
  WAITLIST_PLATFORM_LABELS,
  WAITLIST_CONSENT_VERSION,
  WAITLIST_NEWSLETTER_CONSENT_VERSION,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_CODE_RE,
  normalizeReferralCode,
  normalizeSource,
  readWaitlistAttribution,
  waitlistSignupSchema,
  waitlistUnsubscribeSchema,
  EMPTY_WAITLIST_FORM,
  isWaitlistFormComplete,
  buildWaitlistPayload,
  waitlistReferralUrl,
  waitlistStatusPath,
  waitlistUnsubscribePath,
  waitlistShareText,
  whatsappShareHref,
} from './types/waitlist.js'
export type {
  WaitlistHouseholdSize,
  WaitlistPlannerRole,
  WaitlistCurrentMethod,
  WaitlistPlatform,
  WaitlistStatus,
  WaitlistAttribution,
  WaitlistSignup,
  WaitlistSignupResponse,
  WaitlistStatusResponse,
  WaitlistFormState,
  WaitlistSignupPayload,
} from './types/waitlist.js'
