import { z } from 'zod'
import {
  DIFFICULTIES,
  MEALS,
  SEASONS,
  SOURCE_TYPES,
  UNITS,
  type Difficulty,
  type Meal,
  type Season,
  type SourceType,
  type Unit,
} from '../constants/enums.js'

// ─── Nutrition (cached, per-serving) ──────────────────────────
// Computed and stored by the API on every recipe save. Optional/nullable
// from a type perspective because newly-extracted recipes won't have it
// until the lint validator + nutrition pipeline run, but in practice
// every persisted recipe carries this object.
export const nutritionPerServingSchema = z.object({
  kcal: z.number().min(0),
  proteinG: z.number().min(0),
  carbsG: z.number().min(0),
  fatG: z.number().min(0),
  fiberG: z.number().min(0),
  saltG: z.number().min(0),
})

export type NutritionPerServing = z.infer<typeof nutritionPerServingSchema>

// ─── Recipe ingredient (one row per ingredient on a recipe) ───
const recipeIngredientWriteSchema = z.object({
  ingredientId: z.string().uuid(),
  /**
   * Optional sub-grouping within the recipe (e.g. "Para la masa").
   * Omitted = ungrouped.
   */
  section: z.string().optional(),
  /**
   * Quantity must be > 0 for measurable units. For symbolic units
   * (`pizca`, `al_gusto`) the quantity is ignored downstream — 0 is
   * accepted so the LLM regen pipeline doesn't get blocked when it emits
   * a zero "to taste" entry.
   */
  quantity: z.number().min(0),
  unit: z.enum(UNITS),
  optional: z.boolean().default(false),
  note: z.string().optional(),
  displayOrder: z.number().int().min(0).default(0),
  /**
   * Human-readable quantity as entered/extracted (e.g. 2 for "2 cda").
   * Canonical `quantity` holds the converted SI value (e.g. 30 ml).
   * Null/absent when no display conversion applies.
   */
  displayQuantity: z.number().min(0).nullable().optional(),
  /**
   * Human-readable unit label as entered/extracted (e.g. "cda").
   * Null/absent when no display conversion applies.
   */
  displayUnit: z.string().max(40).nullable().optional(),
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
export const recipeStepSchema = z.object({
  /** 0-based position in the recipe */
  index: z.number().int().min(0),
  text: z.string().min(1),
  /** Time the step itself takes, in minutes */
  durationMin: z.number().int().min(0).optional(),
  /** Cooking temperature, °C (oven, pan, water bath…) */
  temperature: z.number().int().min(-30).max(300).optional(),
  /** Short technique label ("sofreír", "hornear", "marinar") */
  technique: z.string().optional(),
  // validated server-side against the recipe's ingredients[].id; the schema can't enforce that cross-field constraint
  ingredientRefs: z.array(z.string().uuid()).default([]),
})

export type RecipeStep = z.infer<typeof recipeStepSchema>

// ─── Recipe (server-read shape) ───────────────────────────────
export interface Recipe {
  id: string
  name: string
  authorId: string | null
  imageUrl?: string | null

  // Yield / portioning
  servings: number
  /** Confidence level for the servings value: 'explicit' = stated in the source, 'estimated' = inferred. DB default 'explicit'. */
  servingsConfidence: 'explicit' | 'estimated'
  /** Optional human-readable yield (e.g. "12 albóndigas", "1 L de salsa"). JSON field is `yieldText` to avoid the JS reserved word. */
  yieldText?: string

  // Times (minutes). `totalTime` is server-derived and read-only on the client.
  prepTime?: number
  cookTime?: number
  activeTime?: number
  totalTime?: number

  difficulty: Difficulty

  meals: Meal[]
  seasons: Season[]
  /**
   * Three-state fit per meal/season — `{ [meal]: 'mid' | 'perfect' }`.
   * Absent key = 'none' (matcher excludes). Optional on the wire so the
   * public catalogue and older clients don't need to know about it.
   */
  mealFit?: MealFitMap
  seasonFit?: SeasonFitMap
  /**
   * Scheduling-frequency hint consumed by the matcher. Null/undefined =
   * 'normal' (default weight). See `FREQUENCY_WEIGHT` for the weights.
   */
  frequency?: RecipeFrequency | null

  equipment: string[]
  /** Auto-aggregated from ingredients on save */
  allergens: string[]

  notes?: string
  tips?: string
  substitutions?: string
  storage?: string

  /** Cached nutrition per serving — recomputed on every save */
  nutritionPerServing?: NutritionPerServing | null

  /** Public-facing tags (already filtered: no internal labels, no meal/difficulty duplicates) */
  tags: string[]
  /** Hidden from public UI (e.g. "compartida", "auto-extracted") */
  internalTags: string[]

  /** Origin URL when the recipe was imported from an article or YouTube video (null otherwise). */
  sourceUrl?: string | null
  /** Provenance hint: how this recipe entered the catalog. */
  sourceType?: SourceType | null

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
  servingsConfidence: z.enum(['explicit', 'estimated']).default('explicit'),
  yieldText: z.string().optional(),

  prepTime: z.number().int().min(0).optional(),
  cookTime: z.number().int().min(0).optional(),
  activeTime: z.number().int().min(0).optional(),

  difficulty: z.enum(DIFFICULTIES).default('medium'),

  meals: z.array(z.enum(MEALS)).min(1),
  seasons: z.array(z.enum(SEASONS)).default([]),
  // Optional three-state fit maps. Loose record validation here; the
  // route layer drops unknown keys + caps to the canonical enum domain.
  mealFit: z.record(z.string(), z.enum(['mid', 'perfect'])).optional(),
  seasonFit: z.record(z.string(), z.enum(['mid', 'perfect'])).optional(),
  frequency: z.enum(['frequent', 'normal', 'occasional', 'weekends_only']).nullable().optional(),

  equipment: z.array(z.string()).default([]),

  notes: z.string().optional(),
  tips: z.string().optional(),
  substitutions: z.string().optional(),
  storage: z.string().optional(),

  tags: z.array(z.string()).default([]),
  internalTags: z.array(z.string()).default([]),

  sourceUrl: z.string().url().nullable().optional(),
  sourceType: z.enum(SOURCE_TYPES).nullable().optional(),

  ingredients: z.array(recipeIngredientWriteSchema).min(1),
  steps: z.array(recipeStepSchema).default([]),
})

export const updateRecipeSchema = createRecipeSchema.partial()

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>

// ─── Scheduling frequency hint ─────────────────────────────────
//
// User-controlled hint that tells the menu matcher how often a recipe
// should appear. Distinct from meal/season fit (which is "where it fits")
// — this answers "how often the planner should pick it":
//
//   - frequent       → pool weight ×2 (matches favourite-boost magnitude)
//   - normal         → 1× (the default; encoded as `undefined`/null on
//                      the wire to keep the common case implicit)
//   - occasional     → 0.4× (still selectable but rare)
//   - weekends_only  → excluded from Mon-Fri slots; baseline weight on
//                      Sat/Sun. Hard filter, not a soft preference.
//
// Pool weighting composes multiplicatively with meal/season fit and the
// favourite boost. The matcher reads this from the recipe row directly;
// it doesn't depend on tags so spelling drift can't break the matcher.
export const FREQUENCY_LEVELS = [
  'frequent',
  'normal',
  'occasional',
  'weekends_only',
] as const
export type RecipeFrequency = (typeof FREQUENCY_LEVELS)[number]

/** Weight applied to the recipe's selection pool entry — see comment above. */
export const FREQUENCY_WEIGHT: Record<RecipeFrequency, number> = {
  frequent: 2,
  normal: 1,
  occasional: 0.4,
  weekends_only: 1,
}

export const recipeFrequencySchema = z.enum(FREQUENCY_LEVELS)

// ─── Meal / Season fit ─────────────────────────────────────────
//
// Each recipe scores 'mid' or 'perfect' against any meal slot and any
// season it's tagged for; absence of the key means 'none' and the matcher
// excludes the recipe from that slot. Stored as parallel jsonb columns
// next to the legacy `meals: text[]` / `seasons: text[]` arrays — the API
// keeps both in sync so old consumers (the public catalogue endpoint, the
// assistant skills) don't need to know about fit levels yet.

export const FIT_LEVELS = ['mid', 'perfect'] as const
export type FitLevel = (typeof FIT_LEVELS)[number]

/** Score per meal slot. Missing keys = 'none' (excluded). */
export type MealFitMap = Partial<Record<import('../constants/enums.js').Meal, FitLevel>>
/** Score per season. Missing keys = 'none' (excluded). */
export type SeasonFitMap = Partial<Record<import('../constants/enums.js').Season, FitLevel>>

export const fitLevelSchema = z.enum(FIT_LEVELS)
// Zod can't express `Partial<Record<Meal, FitLevel>>` directly without
// duplicating the Meal/Season enums into the validator — keep it loose
// here and let the route's enum-aware sanitizer drop unknown keys.
export const mealFitMapSchema = z.record(z.string(), fitLevelSchema)
export const seasonFitMapSchema = z.record(z.string(), fitLevelSchema)

/**
 * Pool-weighting factor used by the menu generator's `pickRandom`. A perfect
 * fit triples the chance of being picked vs. a mid fit (which is the
 * baseline); favourites multiply on top via the existing 2× boost.
 */
export const FIT_WEIGHT: Record<FitLevel, number> = { mid: 1, perfect: 3 }

// ─── Per-household ingredient overrides (sustituciones) ──────
//
// Structured edits a household applies to a recipe's ingredient list, used
// by `recipe_notes.ingredient_overrides`. Three kinds:
//   - 'remove' targets an existing row by its recipe_ingredient id and the
//     recipe detail renders that row struck-through.
//   - 'modify' changes quantity / unit on an existing row; the detail renders
//     the original value next to the new one (original struck-through).
//   - 'add' inserts a brand-new line at the bottom of the section; can be
//     anchored to a catalog `ingredientId`, or free-form via `label` when the
//     user wants something we don't catalog (e.g. "una pizca de algo raro").
//
// All quantities are in the same units the recipe stores (the canonical
// `Unit` enum). Quantity null / unit null on 'modify' means "leave that
// field unchanged" so the user can adjust one dimension at a time. The
// store sanitizes — drops unknown kinds, dedupes by (kind, target), caps
// the array at 50 entries.
export const ingredientOverrideSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('remove'),
    recipeIngredientId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('modify'),
    recipeIngredientId: z.string().uuid(),
    quantity: z.number().min(0).max(10_000).nullable().optional(),
    unit: z.enum(UNITS).nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  }),
  z.object({
    kind: z.literal('add'),
    ingredientId: z.string().uuid().nullable().optional(),
    label: z.string().min(1).max(120),
    quantity: z.number().min(0).max(10_000).nullable().optional(),
    unit: z.enum(UNITS).nullable().optional(),
  }),
])

export type IngredientOverride = z.infer<typeof ingredientOverrideSchema>

// ─── Recipe extraction from photo ──────────────────────────
export interface ExtractedIngredient {
  extractedName: string
  ingredientId: string | null
  ingredientName: string | null
  quantity: number
  unit: Unit
  matched: boolean
  /** Human-readable quantity as entered/extracted (e.g. 2 for "2 cda").
   * Null/absent when no display conversion applies. */
  displayQuantity?: number | null
  /** Human-readable unit label as entered/extracted (e.g. "cda").
   * Null/absent when no display conversion applies. */
  displayUnit?: string | null
}

export interface ExtractedRecipe {
  name: string
  /** Source image URL captured by the URL extractor (schema.org Recipe.image,
   * og:image, twitter:image, or YouTube thumbnail). Null/undefined for the
   * photo + manual paths. The form / route handler persists this into
   * `recipes.image_url`. */
  imageUrl?: string | null
  /** Always a positive integer. The extractor defaults to 2 when the source is silent. */
  servings: number
  /** 'explicit' = servings value was stated in the source; 'estimated' = inferred/defaulted by the extractor. */
  servingsConfidence: 'explicit' | 'estimated'
  prepTime: number | null
  cookTime: number | null
  meals: Meal[]
  seasons: Season[]
  difficulty: Difficulty | null
  tags: string[]
  // flat strings from the photo extractor; promoted to RecipeStep[] by the importer pipeline
  steps: string[]
  ingredients: ExtractedIngredient[]
  unmatchedCount: number
  warnings: string[]
  /** Set by the URL extractor; null/undefined for image and manual sources. */
  sourceUrl?: string | null
  sourceType?: SourceType | null
}
