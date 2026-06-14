import { z } from 'zod'
import type { Meal } from '../constants/enums.js'
import type { Dish } from './menuDish.js'

export interface MealSlot {
  /** Slot-level diner override; replaces the household default for every dish in this slot. */
  servings?: number | null
  /** Ordered list of dishes; length ≥ 1 after at least one populate, but `[]` is transient and valid. */
  dishes: Dish[]
}

export interface DayMenu {
  [meal: string]: MealSlot | undefined
}

/** Per-meal-type dish count config for the menu generator. Default 1. */
export type MealDishCounts = Partial<Record<Meal, 1 | 2 | 3>>

export interface Menu {
  id: string
  userId: string
  weekStart: string // ISO date string (YYYY-MM-DD)
  days: DayMenu[]   // Array of 7 days
  locked: LockedSlots
  /**
   * Recipe ids the user vetoed for this week. The matcher excludes them
   * across the whole menu (any slot, any regeneration call). Scope is one
   * menu — next week starts with an empty list.
   */
  bannedRecipeIds: string[]
  /**
   * Day indices (0-6) the user marked "sin cocinar". Whole-week
   * regeneration leaves these days untouched; the user must add slots
   * back manually after un-skipping.
   */
  skippedDays: number[]
  createdAt: Date
}

export interface LockedSlots {
  [dayIndex: string]: {
    [meal: string]: boolean
  }
}

export const generateMenuSchema = z.object({
  userId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customTemplate: z.array(z.record(z.boolean())).optional(),
  /**
   * When `true`, skip the matcher and write a row with all 7 days
   * structured per the user's `mealTemplate` but every slot empty
   * (`dishes: []`). Powers "Vaciar semana" + "Empezar de cero".
   */
  empty: z.boolean().optional(),
})

export const lockMealSchema = z.object({
  locked: z.boolean(),
})
