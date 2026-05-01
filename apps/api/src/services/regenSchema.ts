/**
 * Loosened recipe schema for the regeneration pipeline.
 *
 * The LLM regen pipeline (Task 8) emits recipes with TEMPORARY string
 * `ingredientRefs` of the form `"ing_<INDEX>"`, where INDEX is the 0-based
 * position of the referenced ingredient in the recipe's `ingredients` array.
 *
 * `createRecipeSchema` (the canonical write schema in `@ona/shared`) requires
 * `step.ingredientRefs` to be UUIDs. That contract is wrong for the regen
 * pipeline — the recipe_ingredients rows don't exist yet, so the LLM cannot
 * know their IDs. The apply script (Task 9) mints UUIDs for those rows on
 * the fly and resolves the temp ids to real UUIDs before writing to DB.
 *
 * This schema is the same shape as `createRecipeSchema`, with the single
 * difference that `step.ingredientRefs` is a plain `string[]` instead of
 * `string.uuid()[]`. Everything else (units, meals, seasons, difficulties,
 * required fields) stays identical.
 *
 * Used by:
 *   - apps/api/scripts/regenerateRecipes.ts  (Task 8 — emits regen JSONL)
 *   - apps/api/scripts/applyRegeneratedRecipes.ts  (Task 9 — applies it)
 */

import { z } from 'zod'
import {
  DIFFICULTIES,
  MEALS,
  SEASONS,
  UNITS,
  nutritionPerServingSchema,
} from '@ona/shared'

const regenIngredientSchema = z.object({
  ingredientId: z.string().min(1),
  section: z.string().optional(),
  quantity: z.number().positive(),
  unit: z.enum(UNITS),
  optional: z.boolean().default(false),
  note: z.string().optional(),
  displayOrder: z.number().int().min(0).default(0),
})

const regenStepSchema = z.object({
  index: z.number().int().min(0),
  text: z.string().min(1),
  durationMin: z.number().int().min(0).optional(),
  temperature: z.number().int().min(-30).max(300).optional(),
  technique: z.string().optional(),
  /** Temporary string ids ("ing_0", "ing_1", ...) — resolved to UUIDs on apply. */
  ingredientRefs: z.array(z.string()).default([]),
})

export const regenRecipeSchema = z.object({
  name: z.string().min(1),
  imageUrl: z.string().url().nullable().optional(),
  servings: z.number().int().positive(),
  yieldText: z.string().optional(),
  prepTime: z.number().int().min(0).optional(),
  cookTime: z.number().int().min(0).optional(),
  activeTime: z.number().int().min(0).optional(),
  difficulty: z.enum(DIFFICULTIES).default('medium'),
  meals: z.array(z.enum(MEALS)).min(1),
  seasons: z.array(z.enum(SEASONS)).default([]),
  equipment: z.array(z.string()).default([]),
  notes: z.string().optional(),
  tips: z.string().optional(),
  substitutions: z.string().optional(),
  storage: z.string().optional(),
  tags: z.array(z.string()).default([]),
  internalTags: z.array(z.string()).default([]),
  ingredients: z.array(regenIngredientSchema).min(1),
  steps: z.array(regenStepSchema).default([]),
  /** Optional — the regen pipeline may volunteer it; the apply script ignores it and recomputes. */
  nutritionPerServing: nutritionPerServingSchema.nullable().optional(),
})

export type RegenRecipe = z.infer<typeof regenRecipeSchema>
export type RegenIngredient = z.infer<typeof regenIngredientSchema>
export type RegenStep = z.infer<typeof regenStepSchema>
