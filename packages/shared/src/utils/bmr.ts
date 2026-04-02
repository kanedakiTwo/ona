import type { ActivityLevel, Sex } from '../constants/enums.js'
import { ACTIVITY_FACTORS } from '../constants/nutrition.js'

/**
 * Basal Metabolic Rate using Mifflin-St Jeor equation.
 * Returns kcal/day.
 */
export function calculateBMR(sex: Sex, weight: number, height: number, age: number): number {
  const base = 10 * weight + 6.25 * height - 5 * age
  return sex === 'male' ? base + 5 : base - 161
}

/**
 * Activity factor multiplier.
 */
export function getActivityFactor(activity: ActivityLevel): number {
  return ACTIVITY_FACTORS[activity] ?? 1.2
}

/**
 * Total Daily Energy Expenditure = BMR × activity factor.
 */
export function calculateTDEE(sex: Sex, weight: number, height: number, age: number, activity: ActivityLevel): number {
  return calculateBMR(sex, weight, height, age) * getActivityFactor(activity)
}

/**
 * Daily calories adjusted for a menu covering N meals (not full 21-meal weeks).
 */
export function calculateMenuTargetCalories(
  sex: Sex,
  weight: number,
  height: number,
  age: number,
  activity: ActivityLevel,
  totalMealsInMenu: number,
): number {
  const dailyCalories = calculateTDEE(sex, weight, height, age, activity)
  // Assume 3 meals per day as baseline, scale by actual meals in the menu
  return dailyCalories * (totalMealsInMenu / 3)
}
