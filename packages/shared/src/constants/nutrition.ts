import type { ActivityLevel } from './enums.js'

// Default target macro percentages
export const TARGET_MACROS = {
  carbohydrates: 57,
  fat: 25,
  protein: 15,
} as const

// Macro ranges (min/max % of daily calories)
export const MACRO_RANGES = {
  carbohydrates: { min: 45, max: 65 },
  fat: { min: 20, max: 35 },
  protein: { min: 10, max: 35 },
} as const

// Activity factor multipliers for TDEE calculation
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  none: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
}

// Menu generation algorithm constants
export const MENU_GENERATION = {
  MAX_ITERATIONS: 200,
  MIN_FITNESS: 1000,
  OPTIMAL_FITNESS: 5,
} as const

// Nutrient balance EMA weights
export const EMA_WEIGHTS = {
  NEW: 0.7,
  OLD: 0.3,
} as const

// RDA values (Recommended Dietary Allowances)
export const MINERALS_RDA = {
  calcium: { rda: 1000, ul: 2500, unit: 'mg' },
  iron: { rda: 8, ul: 45, unit: 'mg' },
  magnesium: { rda: 420, unit: 'mg' },
  zinc: { rda: 11, ul: 40, unit: 'mg' },
  selenium: { rda: 55, ul: 400, unit: 'ug' },
  potassium: { rda: 4700, unit: 'mg' },
  sodium: { rda: 1500, ul: 2300, unit: 'mg' },
  phosphorus: { rda: 700, ul: 4000, unit: 'mg' },
  iodine: { rda: 150, ul: 1100, unit: 'ug' },
  copper: { rda: 900, ul: 10000, unit: 'ug' },
  manganese: { rda: 2.3, ul: 11, unit: 'mg' },
  chromium: { rda: 35, unit: 'ug' },
  fluoride: { rda: 4, ul: 10, unit: 'mg' },
  molybdenum: { rda: 45, ul: 2000, unit: 'ug' },
} as const

export const VITAMINS_RDA = {
  A: { rda: 900, ul: 3000, unit: 'ug' },
  C: { rda: 90, ul: 2000, unit: 'mg' },
  D: { rda: 15, ul: 100, unit: 'ug' },
  E: { rda: 15, ul: 1000, unit: 'mg' },
  K: { rda: 80, unit: 'ug' },
  B1: { rda: 1.2, unit: 'mg' },
  B2: { rda: 1.2, unit: 'mg' },
  B3: { rda: 15, ul: 35, unit: 'mg' },
  B5: { rda: 5, unit: 'mg' },
  B6: { rda: 1.4, ul: 100, unit: 'mg' },
  B9: { rda: 400, ul: 1000, unit: 'ug' },
  B12: { rda: 2.4, unit: 'ug' },
} as const
