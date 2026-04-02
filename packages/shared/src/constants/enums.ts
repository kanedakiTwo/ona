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

// Household size (onboarding Q1)
export const HOUSEHOLD_SIZES = ['solo', 'couple', 'family_with_kids', 'family_no_kids'] as const
export type HouseholdSize = (typeof HOUSEHOLD_SIZES)[number]

// Cooking frequency (onboarding Q2)
export const COOKING_FREQUENCIES = ['daily', '3_4_times', 'rarely'] as const
export type CookingFrequency = (typeof COOKING_FREQUENCIES)[number]

// User priority (onboarding Q5)
export const PRIORITIES = ['quick', 'varied', 'healthy', 'cheap'] as const
export type Priority = (typeof PRIORITIES)[number]

// Household size multiplier for shopping list quantities
export const HOUSEHOLD_MULTIPLIER: Record<HouseholdSize, number> = {
  solo: 1,
  couple: 2,
  family_with_kids: 4,
  family_no_kids: 3,
}
