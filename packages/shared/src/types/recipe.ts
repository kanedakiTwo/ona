import { z } from 'zod'
import {
  DIFFICULTIES,
  MEALS,
  SEASONS,
  UNITS,
  type Difficulty,
  type Meal,
  type Season,
  type Unit,
} from '../constants/enums.js'

// ─── Nutrition (cached, per-serving) ──────────────────────────
// Computed and stored by the API on every recipe save. Optional/nullable
// from a type perspective because newly-extracted recipes won't have it
// until the lint validator + nutrition pipeline run, but in practice
// every persisted recipe carries this object.
export const nutritionPerServingSchema = z.object({
  kcal: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  fat_g: z.number().min(0),
  fiber_g: z.number().min(0),
  salt_g: z.number().min(0),
})

export type NutritionPerServing = z.infer<typeof nutritionPerServingSchema>

// ─── Recipe ingredient (one row per ingredient on a recipe) ───
const recipeIngredientWriteSchema = z.object({
  ingredientId: z.string().uuid(),
  /**
   * Optional sub-grouping within the recipe (e.g. "Para la masa").
   * `null` / omitted = ungrouped.
   */
  section: z.string().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.enum(UNITS),
  optional: z.boolean().default(false),
  note: z.string().nullable().optional(),
  displayOrder: z.number().int().min(0).default(0),
})

export const recipeIngredientSchema = recipeIngredientWriteSchema.extend({
  /** Server-set: id of this recipe_ingredient row (referenced by step.ingredientRefs) */
  id: z.string().uuid(),
  /** Server-set: denormalized name for display */
  ingredientName: z.string().optional(),
})

export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>
export type RecipeIngredientInput = z.infer<typeof recipeIngredientWriteSchema>

// ─── Recipe step ──────────────────────────────────────────────
const recipeStepWriteSchema = z.object({
  /** 0-based position in the recipe */
  index: z.number().int().min(0),
  text: z.string().min(1),
  /** Time the step itself takes, in minutes */
  durationMin: z.number().int().min(0).nullable().optional(),
  /** Cooking temperature, °C (oven, pan, water bath…) */
  temperature: z.number().int().nullable().optional(),
  /** Short technique label ("sofreír", "hornear", "marinar") */
  technique: z.string().nullable().optional(),
  /**
   * RecipeIngredient row ids referenced in this step. Used to render
   * inline quantities and to highlight ingredients in cooking mode.
   */
  ingredientRefs: z.array(z.string().uuid()).default([]),
})

export const recipeStepSchema = recipeStepWriteSchema

export type RecipeStep = z.infer<typeof recipeStepSchema>
export type RecipeStepInput = z.infer<typeof recipeStepWriteSchema>

// ─── Recipe (server-read shape) ───────────────────────────────
export interface Recipe {
  id: string
  name: string
  authorId: string | null
  imageUrl?: string | null

  // Yield / portioning
  servings: number
  /** Optional human-readable yield (e.g. "12 albóndigas", "1 L de salsa"). JSON field is `yieldText` to avoid the JS reserved word. */
  yieldText?: string | null

  // Times (minutes). `totalTime` is server-derived and read-only on the client.
  prepTime?: number | null
  cookTime?: number | null
  activeTime?: number | null
  totalTime?: number | null

  difficulty: Difficulty

  meals: Meal[]
  seasons: Season[]

  equipment: string[]
  /** Auto-aggregated from ingredients on save */
  allergens: string[]

  notes?: string | null
  tips?: string | null
  substitutions?: string | null
  storage?: string | null

  /** Cached nutrition per serving — recomputed on every save */
  nutritionPerServing?: NutritionPerServing | null

  /** Public-facing tags (already filtered: no internal labels, no meal/difficulty duplicates) */
  tags: string[]
  /** Hidden from public UI (e.g. "compartida", "auto-extracted") */
  internalTags: string[]

  ingredients: RecipeIngredient[]
  steps: RecipeStep[]

  is_favorite?: boolean
  createdAt: Date
  updatedAt: Date
}

// ─── Client → server schemas ──────────────────────────────────
// Note: `totalTime`, `allergens`, and `nutritionPerServing` are
// server-derived and intentionally absent from the write schemas.
export const createRecipeSchema = z.object({
  name: z.string().min(1),
  imageUrl: z.string().url().nullable().optional(),

  servings: z.number().int().positive(),
  yieldText: z.string().nullable().optional(),

  prepTime: z.number().int().min(0).nullable().optional(),
  cookTime: z.number().int().min(0).nullable().optional(),
  activeTime: z.number().int().min(0).nullable().optional(),

  difficulty: z.enum(DIFFICULTIES).default('medium'),

  meals: z.array(z.enum(MEALS)).min(1),
  seasons: z.array(z.enum(SEASONS)).default([]),

  equipment: z.array(z.string()).default([]),

  notes: z.string().nullable().optional(),
  tips: z.string().nullable().optional(),
  substitutions: z.string().nullable().optional(),
  storage: z.string().nullable().optional(),

  tags: z.array(z.string()).default([]),
  internalTags: z.array(z.string()).default([]),

  ingredients: z.array(recipeIngredientWriteSchema).min(1),
  steps: z.array(recipeStepWriteSchema).default([]),
})

export const updateRecipeSchema = createRecipeSchema.partial()

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>

// ─── Recipe extraction from photo ──────────────────────────
export interface ExtractedIngredient {
  extractedName: string
  ingredientId: string | null
  ingredientName: string | null
  quantity: number
  unit: Unit
  matched: boolean
}

export interface ExtractedRecipe {
  name: string
  servings: number | null
  prepTime: number | null
  cookTime: number | null
  meals: Meal[]
  seasons: Season[]
  difficulty: Difficulty | null
  tags: string[]
  steps: string[]
  ingredients: ExtractedIngredient[]
  unmatchedCount: number
  warnings: string[]
}
