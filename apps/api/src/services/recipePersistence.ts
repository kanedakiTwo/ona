/**
 * Shared recipe persistence helper.
 *
 * Single source of truth for the "validate ingredient refs → run lint →
 * compute nutrition + allergens + totalTime → write atomically" pipeline
 * used by:
 *
 *   - POST /recipes
 *   - PUT  /recipes/:id
 *   - POST /recipes/extract-from-image
 *
 * `applyRegeneratedRecipes.ts` (Task 9) shares the same building blocks
 * (lintRecipe, aggregateNutrition, allergenUnion) but runs an additional
 * name-based "find existing → replace in place" pass that doesn't fit this
 * helper's API. It intentionally keeps its own transactional writer.
 *
 * Callers pass a `RecipeWriteInput` (the new model with sectioned ingredients
 * and rich steps). The helper:
 *
 *   1. Mints UUIDs for the recipe_ingredients rows up front.
 *   2. Resolves any `step.ingredientRefs[j]` of the form `"ing_<n>"` to the
 *      minted UUID at index `<n>`. Real UUIDs that already match a minted id
 *      are passed through. Anything else is reported as a STEP_REF_DANGLING
 *      lint issue and the persist call short-circuits.
 *   3. Runs `lintRecipe()` against the live ingredient catalog.
 *   4. If lint fails, returns `{ ok: false, errors, warnings }` without
 *      touching the DB.
 *   5. Computes nutrition (`aggregateNutrition`), allergens (`allergenUnion`),
 *      and `totalTime` (sum of `step.durationMin` if all set, else
 *      `prepTime + cookTime`, else null).
 *   6. Performs the write inside a Drizzle transaction:
 *        INSERT mode: insert the recipe row, then ingredients, then steps.
 *        UPDATE mode: delete recipe_steps + recipe_ingredients, update the
 *                     recipe row, re-insert children with newly-minted ids.
 *
 * The helper is deliberately catalog-aware (it loads the catalog itself) so
 * route handlers stay thin: parse → call helper → respond.
 *
 * Pure-helper invariants:
 *   - No HTTP concerns leak in (no req/res). Errors come back as `LintIssue`s.
 *   - No console logging unless `opts.verbose === true`. The apply script
 *     does its own logging at the call-site.
 */

import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'

import { db } from '../db/connection.js'
import {
  ingredients as ingredientsTable,
  recipes as recipesTable,
  recipeIngredients as recipeIngredientsTable,
  recipeSteps as recipeStepsTable,
} from '../db/schema.js'
import {
  lintRecipe,
  type CatalogIngredient,
  type LintIssue,
  type LintResult,
  type RecipeInput as LintInput,
} from './recipeLint.js'
import {
  aggregateNutrition,
  type IngredientCatalogEntry,
} from './nutrition/aggregate.js'
import { allergenUnion } from './nutrition/allergens.js'
import type {
  Difficulty,
  Meal,
  NutritionPerServing,
  Season,
  Unit,
} from '@ona/shared'

// ─── Public types ───────────────────────────────────────────────

/** A single ingredient row in a write payload. `id` is optional; if absent we mint. */
export interface RecipeIngredientWriteInput {
  /** Pre-minted row id. If absent we mint a UUID. Used by callers that need
   *  to reference the row from `step.ingredientRefs` before persisting. */
  id?: string
  ingredientId: string
  section?: string | null
  quantity: number
  unit: Unit
  optional?: boolean
  note?: string | null
  displayOrder?: number
}

/** A single step row in a write payload. */
export interface RecipeStepWriteInput {
  index: number
  text: string
  durationMin?: number | null
  temperature?: number | null
  technique?: string | null
  /**
   * Either `"ing_<n>"` referencing the n-th ingredient in `ingredients`,
   * OR a real UUID that matches the `id` of a row in `ingredients`.
   * The helper resolves the former before lint.
   */
  ingredientRefs?: string[]
}

/** The full write shape the helper accepts. Mirrors `createRecipeSchema` plus the regen extras. */
export interface RecipeWriteInput {
  name: string
  imageUrl?: string | null
  servings: number
  yieldText?: string | null
  prepTime?: number | null
  cookTime?: number | null
  activeTime?: number | null
  difficulty?: Difficulty
  meals: Meal[]
  seasons?: Season[]
  equipment?: string[]
  notes?: string | null
  tips?: string | null
  substitutions?: string | null
  storage?: string | null
  tags?: string[]
  internalTags?: string[]
  ingredients: RecipeIngredientWriteInput[]
  steps: RecipeStepWriteInput[]
}

export interface PersistOptions {
  /** Author. `null` = system recipe (used by apply / seed). */
  authorId: string | null
  /** When true, skips QUANTITY_OUT_OF_RANGE lint errors. */
  force?: boolean
  /**
   * If set, the helper performs an UPDATE on the row with this id (and clears
   * its child rows first). If absent, the helper INSERTs a new row.
   */
  recipeId?: string
  /**
   * For UPDATE mode: when true, preserve the existing `imageUrl` unless the
   * input carries a non-null one. The route handler always passes false; the
   * apply script passes true.
   */
  preserveExistingImage?: boolean
}

export interface PersistOk {
  ok: true
  recipeId: string
  /** The minted (or echoed) UUID of each recipe_ingredients row, in input order. */
  ingredientRowIds: string[]
  warnings: LintIssue[]
  nutritionPerServing: NutritionPerServing
  allergens: string[]
  totalTime: number | null
}

export interface PersistErr {
  ok: false
  errors: LintIssue[]
  warnings: LintIssue[]
}

export type PersistResult = PersistOk | PersistErr

// ─── Catalog cache ──────────────────────────────────────────────

interface FullCatalogRow extends CatalogIngredient {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  salt: number
}

interface BuiltCatalog {
  full: FullCatalogRow[]
  lint: CatalogIngredient[]
  nutrition: Map<string, IngredientCatalogEntry>
  allergens: Map<string, { allergenTags?: string[] | null }>
  loadedAt: number
}

let cached: BuiltCatalog | null = null
const CATALOG_TTL_MS = 60_000 // 1 minute — short enough to pick up seed changes

async function loadCatalog(): Promise<BuiltCatalog> {
  const now = Date.now()
  if (cached && now - cached.loadedAt < CATALOG_TTL_MS) return cached

  const rows = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      allergenTags: ingredientsTable.allergenTags,
      fdcId: ingredientsTable.fdcId,
      density: ingredientsTable.density,
      unitWeight: ingredientsTable.unitWeight,
      calories: ingredientsTable.calories,
      protein: ingredientsTable.protein,
      carbs: ingredientsTable.carbs,
      fat: ingredientsTable.fat,
      fiber: ingredientsTable.fiber,
      salt: ingredientsTable.salt,
    })
    .from(ingredientsTable)

  const full: FullCatalogRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    allergenTags: r.allergenTags ?? [],
    fdcId: r.fdcId,
    density: r.density,
    unitWeight: r.unitWeight,
    calories: r.calories ?? 0,
    protein: r.protein ?? 0,
    carbs: r.carbs ?? 0,
    fat: r.fat ?? 0,
    fiber: r.fiber ?? 0,
    salt: r.salt ?? 0,
  }))

  const lint = full.map((c) => ({
    id: c.id,
    name: c.name,
    allergenTags: c.allergenTags,
    fdcId: c.fdcId,
    density: c.density,
    unitWeight: c.unitWeight,
  }))

  const nutrition = new Map<string, IngredientCatalogEntry>()
  for (const c of full) {
    nutrition.set(c.id, {
      id: c.id,
      name: c.name,
      calories: c.calories,
      protein: c.protein,
      carbs: c.carbs,
      fat: c.fat,
      fiber: c.fiber,
      salt: c.salt,
      density: c.density,
      unitWeight: c.unitWeight,
    })
  }

  const allergens = new Map<string, { allergenTags?: string[] | null }>()
  for (const c of full) {
    allergens.set(c.id, { allergenTags: c.allergenTags ?? [] })
  }

  cached = { full, lint, nutrition, allergens, loadedAt: now }
  return cached
}

/** Force a refresh on next call (used after seed inserts new ingredients). */
export function invalidateRecipeCatalogCache(): void {
  cached = null
}

// ─── Ref resolution ─────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ING_TEMP_RE = /^ing_(\d+)$/

interface ResolvedStep {
  index: number
  text: string
  durationMin: number | null
  temperature: number | null
  technique?: string
  ingredientRefs: string[]
}

interface ResolvedSteps {
  steps: ResolvedStep[]
  errors: LintIssue[]
}

/**
 * Resolve `"ing_<n>"` placeholders to the minted UUID at index `<n>`. Real
 * UUIDs are checked against the minted-ids set; anything else fails as
 * STEP_REF_DANGLING. The lint validator will catch any remaining dangling
 * refs anyway, but resolving up front lets us produce cleaner error paths.
 */
function resolveSteps(
  steps: RecipeStepWriteInput[],
  ingredientRowIds: string[],
): ResolvedSteps {
  const errors: LintIssue[] = []
  const validIds = new Set(ingredientRowIds)

  const resolved = steps.map((step, sIdx) => {
    const refs: string[] = []
    const incoming = step.ingredientRefs ?? []
    for (let j = 0; j < incoming.length; j++) {
      const raw = incoming[j]
      const m = ING_TEMP_RE.exec(raw)
      if (m) {
        const idx = Number(m[1])
        if (idx >= 0 && idx < ingredientRowIds.length) {
          refs.push(ingredientRowIds[idx])
        } else {
          errors.push({
            code: 'STEP_REF_DANGLING',
            message: `El paso ${sIdx + 1} referencia un ingrediente que no existe en la receta.`,
            path: `steps[${sIdx}].ingredientRefs[${j}]`,
          })
        }
        continue
      }
      if (UUID_RE.test(raw)) {
        if (validIds.has(raw)) {
          refs.push(raw)
        } else {
          errors.push({
            code: 'STEP_REF_DANGLING',
            message: `El paso ${sIdx + 1} referencia un ingrediente que no existe en la receta.`,
            path: `steps[${sIdx}].ingredientRefs[${j}]`,
          })
        }
        continue
      }
      errors.push({
        code: 'STEP_REF_DANGLING',
        message: `El paso ${sIdx + 1} contiene una referencia inválida ("${raw}").`,
        path: `steps[${sIdx}].ingredientRefs[${j}]`,
      })
    }
    const out: ResolvedStep = {
      index: step.index,
      text: step.text,
      durationMin: step.durationMin ?? null,
      temperature: step.temperature ?? null,
      ingredientRefs: refs,
    }
    if (step.technique != null) out.technique = step.technique
    return out
  })

  return { steps: resolved, errors }
}

// ─── totalTime ──────────────────────────────────────────────────

function computeTotalTime(input: RecipeWriteInput): number | null {
  const steps = input.steps ?? []
  if (steps.length > 0 && steps.every((s) => s.durationMin != null)) {
    return steps.reduce((acc, s) => acc + (s.durationMin ?? 0), 0)
  }
  const prep = input.prepTime ?? 0
  const cook = input.cookTime ?? 0
  if (prep === 0 && cook === 0) return null
  return prep + cook
}

// ─── Main entry point ───────────────────────────────────────────

export async function persistRecipe(
  input: RecipeWriteInput,
  opts: PersistOptions,
): Promise<PersistResult> {
  // Mint or echo ingredient row UUIDs.
  const ingredientRowIds: string[] = input.ingredients.map((ing) =>
    ing.id && UUID_RE.test(ing.id) ? ing.id : randomUUID(),
  )

  // Resolve refs.
  const refResolution = resolveSteps(input.steps ?? [], ingredientRowIds)
  if (refResolution.errors.length > 0) {
    return { ok: false, errors: refResolution.errors, warnings: [] }
  }

  // Load catalog + lint.
  const catalog = await loadCatalog()
  const lintInput: LintInput = {
    name: input.name,
    servings: input.servings,
    prepTime: input.prepTime ?? null,
    cookTime: input.cookTime ?? null,
    difficulty: input.difficulty,
    meals: input.meals,
    seasons: input.seasons ?? [],
    equipment: input.equipment ?? [],
    tags: input.tags ?? [],
    internalTags: input.internalTags ?? [],
    ingredients: input.ingredients.map((ing, i) => ({
      id: ingredientRowIds[i],
      ingredientId: ing.ingredientId,
      section: ing.section ?? undefined,
      quantity: ing.quantity,
      unit: ing.unit,
      optional: ing.optional ?? false,
      note: ing.note ?? undefined,
      displayOrder: ing.displayOrder ?? i,
    })),
    steps: refResolution.steps,
  }

  const lintResult: LintResult = lintRecipe(lintInput, {
    ingredientCatalog: catalog.lint,
    force: opts.force,
  })
  if (!lintResult.ok) {
    return { ok: false, errors: lintResult.errors, warnings: lintResult.warnings }
  }

  // Compute nutrition + allergens + totalTime.
  const aggregate = aggregateNutrition({
    servings: input.servings,
    ingredients: lintInput.ingredients.map((ing) => ({
      id: ing.id,
      ingredientId: ing.ingredientId,
      quantity: ing.quantity,
      unit: ing.unit,
    })) as any,
    catalog: catalog.nutrition,
  })
  const allergens = allergenUnion(
    input.ingredients.map((ing) => ({ ingredientId: ing.ingredientId })),
    catalog.allergens,
  )
  const totalTime = computeTotalTime(input)

  // Write inside a transaction.
  const recipeId = await db.transaction(async (tx) => {
    const baseFields = {
      name: input.name,
      authorId: opts.authorId,
      servings: input.servings,
      yieldText: input.yieldText ?? null,
      prepTime: input.prepTime ?? null,
      cookTime: input.cookTime ?? null,
      activeTime: input.activeTime ?? null,
      totalTime,
      difficulty: input.difficulty ?? 'medium',
      meals: input.meals,
      seasons: input.seasons ?? [],
      equipment: input.equipment ?? [],
      allergens,
      notes: input.notes ?? null,
      tips: input.tips ?? null,
      substitutions: input.substitutions ?? null,
      storage: input.storage ?? null,
      nutritionPerServing: aggregate.perServing,
      tags: input.tags ?? [],
      internalTags: input.internalTags ?? [],
      updatedAt: new Date(),
    }

    let id: string
    if (opts.recipeId) {
      // UPDATE mode: wipe child rows, update recipe row.
      id = opts.recipeId
      await tx.delete(recipeStepsTable).where(eq(recipeStepsTable.recipeId, id))
      await tx
        .delete(recipeIngredientsTable)
        .where(eq(recipeIngredientsTable.recipeId, id))

      const updateFields: Record<string, unknown> = { ...baseFields }
      if (opts.preserveExistingImage) {
        if (input.imageUrl != null) updateFields.imageUrl = input.imageUrl
      } else {
        updateFields.imageUrl = input.imageUrl ?? null
      }
      await tx.update(recipesTable).set(updateFields).where(eq(recipesTable.id, id))
    } else {
      const [inserted] = await tx
        .insert(recipesTable)
        .values({
          ...baseFields,
          imageUrl: input.imageUrl ?? null,
        })
        .returning({ id: recipesTable.id })
      id = inserted.id
    }

    if (input.ingredients.length > 0) {
      await tx.insert(recipeIngredientsTable).values(
        input.ingredients.map((ing, i) => ({
          id: ingredientRowIds[i],
          recipeId: id,
          ingredientId: ing.ingredientId,
          section: ing.section ?? null,
          quantity: ing.quantity,
          unit: ing.unit,
          optional: ing.optional ?? false,
          note: ing.note ?? null,
          displayOrder: ing.displayOrder ?? i,
        })),
      )
    }

    if (refResolution.steps.length > 0) {
      await tx.insert(recipeStepsTable).values(
        refResolution.steps.map((s) => ({
          recipeId: id,
          index: s.index,
          text: s.text,
          durationMin: s.durationMin,
          temperature: s.temperature,
          technique: s.technique ?? null,
          ingredientRefs: s.ingredientRefs,
        })),
      )
    }

    return id
  })

  return {
    ok: true,
    recipeId,
    ingredientRowIds,
    warnings: lintResult.warnings,
    nutritionPerServing: aggregate.perServing,
    allergens,
    totalTime,
  }
}
