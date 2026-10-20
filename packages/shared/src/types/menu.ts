import { z } from 'zod'
import type { Meal } from '../constants/enums.js'
import type { Dish } from './menuDish.js'
import { weekPlanSchema } from './weekPlan.js'

export interface MealSlot {
  /** Slot-level diner override; replaces the household default for every dish in this slot. */
  servings?: number | null
  /** Ordered list of dishes; length ≥ 1 after at least one populate, but `[]` is transient and valid. */
  dishes: Dish[]
  /**
   * Eaten (PRO-185): set by Mimo (`mark_meal_eaten`) or «Marcar como
   * cocinada» on the web; the menu card shows «✓ Comido» instead of
   * «Empezar a cocinar». `eatenAt` is the ISO time it was marked.
   */
  eaten?: boolean
  eatenAt?: string
  /**
   * PRO-223 · «El táper de mañana»: how many tápers this meal is. The slot
   * holds the previous day's dinner as a leftover and `servings` = this count,
   * so that dinner is cooked with one more ration per táper.
   */
  taper?: number
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
  /** «Cuánto ha acertado» (PRO-155): set when the week is generated; null without it. */
  fit?: MenuFit | null
  createdAt: Date
}

/**
 * PRO-155 · how close a generated week came to what the household likes
 * (favourite dishes, «Me encanta»). Written by a small Claude Haiku call
 * right after generating; null when the call failed or there was nothing
 * to compare with.
 */
export type MenuFitLevel = 'alto' | 'medio' | 'bajo'
/** Why a liked dish is not in the week: we don't have it, or it didn't fit this week. */
export type MenuFitMissReason = 'no_catalogo' | 'no_cabia'
/** Ways to add a recipe of your own: photo, link, or writing it. */
export type RecipeAddMethod = 'foto' | 'enlace' | 'escrita'

export interface MenuFit {
  /** 0–100. */
  score: number
  level: MenuFitLevel
  /** Liked things the week has, with the recipe that covers each. */
  met: Array<{ preference: string; recipe: string | null }>
  missed: Array<{ preference: string; reason: MenuFitMissReason }>
  /** Ways to add recipes this household hasn't used yet (Mimo suggests one). */
  unusedAddMethods: RecipeAddMethod[]
  evaluatedAt: string
}

/** Pure: 0–100 → level. ≥ 70 alto, ≥ 40 medio, below bajo. */
export function menuFitLevel(score: number): MenuFitLevel {
  return score >= 70 ? 'alto' : score >= 40 ? 'medio' : 'bajo'
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
  /**
   * `empty: true` over a week that already has dishes is refused (409
   * MENU_NOT_EMPTY) unless `force: true` — only the user-confirmed
   * "Vaciar semana" sends it. Stops a failed GET from wiping a week.
   */
  force: z.boolean().optional(),
  /**
   * PRO-225 · «Antes de planificar»: meals out and guests for this week
   * only. Shapes the generated week, never the saved plantilla.
   */
  weekPlan: weekPlanSchema.optional(),
  /**
   * PRO-244: the first menu starts on the sign-up day. Days of the week
   * before this date (YYYY-MM-DD) are not generated (they stay without
   * dishes and add nothing to the shopping list).
   */
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const lockMealSchema = z.object({
  locked: z.boolean(),
})
