import { z } from 'zod'
import type { AminoAcids, CarbTypes, FatAcids, Minerals, Vitamins } from './nutrition.js'
import { AISLES, SEASONS, type Aisle, type Season } from '../constants/enums.js'

export interface Ingredient {
  id: string
  name: string
  category?: string
  /**
   * Aisle / shopping section grouping. Drives shopping list grouping
   * and is referenced by the nutrition pipeline. Falls back to `otros`
   * when unset on the catalog row.
   */
  aisle?: Aisle | null
  /** g/ml — needed to convert ml-quantified ingredients to grams for nutrition */
  density?: number | null
  /** g per single unit (e.g. 1 huevo ≈ 50 g) */
  unitWeight?: number | null
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  seasons: Season[]
  vitamins: Vitamins
  minerals: Minerals
  aminoAcids: AminoAcids
  fatAcids: FatAcids
  carbTypes: CarbTypes
  createdAt: Date
  updatedAt: Date
}

export const createIngredientSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  aisle: z.enum(AISLES).nullable().optional(),
  density: z.number().positive().nullable().optional(),
  unitWeight: z.number().positive().nullable().optional(),
  calories: z.number().min(0).default(0),
  protein: z.number().min(0).default(0),
  carbs: z.number().min(0).default(0),
  fat: z.number().min(0).default(0),
  fiber: z.number().min(0).default(0),
  seasons: z.array(z.enum(SEASONS)).default([]),
  vitamins: z.record(z.number()).default({}),
  minerals: z.record(z.number()).default({}),
  aminoAcids: z.record(z.number()).default({}),
  fatAcids: z.record(z.number()).default({}),
  carbTypes: z.record(z.number()).default({}),
})

export const updateIngredientSchema = createIngredientSchema.partial()
