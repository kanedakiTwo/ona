import { z } from 'zod'
import type { Meal, Season } from '../constants/enums.js'

export interface RecipeIngredient {
  ingredientId: string
  ingredientName?: string
  quantity: number
  unit: string
}

export interface Recipe {
  id: string
  name: string
  authorId: string | null
  prepTime?: number
  meals: Meal[]
  seasons: Season[]
  tags: string[]
  steps: string[]
  ingredients: RecipeIngredient[]
  createdAt: Date
  updatedAt: Date
}

export const createRecipeSchema = z.object({
  name: z.string().min(1),
  prepTime: z.number().int().min(1).optional(),
  meals: z.array(z.enum(['breakfast', 'lunch', 'dinner', 'snack'])).min(1),
  seasons: z.array(z.enum(['spring', 'summer', 'autumn', 'winter'])).min(1),
  tags: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  ingredients: z.array(z.object({
    ingredientId: z.string().uuid(),
    quantity: z.number().positive(),
    unit: z.string().default('g'),
  })).min(1),
})

export const updateRecipeSchema = createRecipeSchema.partial()
