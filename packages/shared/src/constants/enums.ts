// Meal types
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type Meal = (typeof MEALS)[number]

// Seasons
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export type Season = (typeof SEASONS)[number]

// Activity levels
export const ACTIVITY_LEVELS = ['none', 'light', 'moderate', 'high'] as const
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number]

// Sex
export const SEXES = ['male', 'female'] as const
export type Sex = (typeof SEXES)[number]

// Household size (legacy onboarding enum — replaced by adults + kidsCount).
// @deprecated Use `users.adults` + `users.kids_2_to_10` instead. Kept here so
// the legacy `HOUSEHOLD_MULTIPLIER` table below can still translate stored
// values during the backfill window.
export const HOUSEHOLD_SIZES = ['solo', 'couple', 'family_with_kids', 'family_no_kids'] as const
export type HouseholdSize = (typeof HOUSEHOLD_SIZES)[number]

// Cooking frequency (onboarding Q2)
export const COOKING_FREQUENCIES = ['daily', '3_4_times', 'rarely'] as const
export type CookingFrequency = (typeof COOKING_FREQUENCIES)[number]

// User priority (onboarding Q5)
export const PRIORITIES = ['quick', 'varied', 'healthy', 'cheap'] as const
export type Priority = (typeof PRIORITIES)[number]

// @deprecated Legacy household-size multiplier. Use
// `householdMultiplier(adults, kidsCount)` from `utils/household` for new
// code. Only the migration backfill and the shopping fallback path still
// reach for this table.
export const HOUSEHOLD_MULTIPLIER: Record<HouseholdSize, number> = {
  solo: 1,
  couple: 2,
  family_with_kids: 4,
  family_no_kids: 3,
}

// Recipe ingredient units
// `pizca` and `al_gusto` never scale with diner count
export const UNITS = ['g', 'ml', 'u', 'cda', 'cdita', 'pizca', 'al_gusto'] as const
export type Unit = (typeof UNITS)[number]

// Recipe difficulty
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

// Recipe source provenance — how this recipe entered the catalog.
// `manual` = typed in via /recipes/new; `image` = photo extractor;
// `article` / `youtube` = URL extractor.
export const SOURCE_TYPES = ['manual', 'image', 'article', 'youtube'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

// Shopping list / ingredient catalog aisle grouping
export const AISLES = [
  'produce',
  'proteinas',
  'lacteos',
  'panaderia',
  'despensa',
  'congelados',
  'otros',
] as const
export type Aisle = (typeof AISLES)[number]
