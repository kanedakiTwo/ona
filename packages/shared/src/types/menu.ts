import { z } from 'zod'
import type { Meal } from '../constants/enums.js'

export interface MealSlot {
  recipeId: string
  recipeName?: string
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
