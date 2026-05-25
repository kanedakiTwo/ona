import { z } from 'zod'
import type { AminoAcids, CarbTypes, FatAcids, Minerals, Vitamins } from './nutrition.js'
import { AISLES, SEASONS, type Aisle, type Season } from '../constants/enums.js'

/**
 * Closed enum of prep methods we know how to schedule a notification for.
 * Adding a value is a 2-line change (`PREP_METHOD_HOURS_BEFORE` map +
 * scheduler awareness); deleting one is a data migration of every
 * `ingredients.prep_requirements.method` storing the old value.
 *
 * Names encode the typical lead time so the LLM populate script and the
 * scheduler don't need a separate config:
 *
 *   - `thaw_24h` / `thaw_48h` — frozen meat / fish; 24h covers fillets,
 *     48h covers whole pieces.
 *   - `soak_overnight` (~8h) — dried legumes (garbanzos, alubias).
 *   - `soak_30min` — lentils (no overnight, but a rinse + 30min).
 *   - `temper_30min` — bring meat to room temp before cooking.
 *   - `marinate_2h` / `marinate_overnight` — flavour-development marinades.
 *   - `dough_rise_overnight` — cold-rise pizza / bread doughs.
 */
export const PREP_METHODS = [
  'thaw_24h',
  'thaw_48h',
  'soak_overnight',
  'soak_30min',
  'temper_30min',
  'marinate_2h',
  'marinate_overnight',
  'dough_rise_overnight',
] as const
export type PrepMethod = (typeof PREP_METHODS)[number]

/** How many hours before the cook time the scheduler should fire the alert. */
export const PREP_METHOD_HOURS_BEFORE: Record<PrepMethod, number> = {
  thaw_24h: 24,
  thaw_48h: 48,
  soak_overnight: 10,
  soak_30min: 1,
  temper_30min: 1,
  marinate_2h: 3,
  marinate_overnight: 12,
  dough_rise_overnight: 12,
}

export interface PrepRequirement {
  method: PrepMethod
  /** Optional Spanish hint shown inside the notification body. */
  notes?: string
}

export const prepRequirementSchema = z.object({
  method: z.enum(PREP_METHODS),
  notes: z.string().max(200).optional(),
})

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
  /** Null when the ingredient needs no anticipation. */
  prepRequirements?: PrepRequirement | null
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
