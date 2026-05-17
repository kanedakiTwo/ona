import { z } from 'zod'
import type { Meal } from '../constants/enums.js'

export interface MealSlot {
  recipeId: string
  recipeName?: string
  /**
   * Per-slot diner-count override. When present, this number replaces the
   * user's household-based default when scaling ingredients for this slot
   * (e.g. shopping-list aggregation, "Para X" caption on the recipe detail
   * when entered from the menu). Absent/null = use the user's household
   * default. The slot is scoped to this week's menu; clearing it on the
   * next regeneration is the user's responsibility.
   */
  servings?: number | null
  /**
   * Pinned meal-type tag. When set, regeneration / random / add for this
   * slot must pick a recipe whose `tags` includes this value (one of
   * MEAL_TYPE_TAGS — 'cremas', 'legumbres', 'pizza' …). Null clears.
   */
  pinnedType?: string | null
  /**
   * Slot kind. `'planned'` (or undefined) is the default; `'leftover'`
   * marks a slot cloned from a previous day's dinner via "Comer sobras".
   * Leftover slots are excluded from re-pick (Aleatorio / Elegir hidden in
   * the UI) and the shopping aggregator handles the repeated recipeId via
   * `sumDinersByRecipe` so quantities aggregate cleanly.
   */
  kind?: 'planned' | 'leftover' | null
  /** Back-reference to the source slot when `kind === 'leftover'`. */
  leftoverOf?: { day: number; meal: string } | null
  /**
   * Hydrated by the menu API on every response from the joined
   * `recipes.image_url` column. NOT persisted in the JSONB; resolved per
   * request so a regenerate-image on the recipe takes effect immediately.
   * Null when the recipe has no image yet.
   */
  imageUrl?: string | null
}

export interface DayMenu {
  [meal: string]: MealSlot | undefined
}

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
})

export const lockMealSchema = z.object({
  locked: z.boolean(),
})
