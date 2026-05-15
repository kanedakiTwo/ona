/**
 * Recipe API routes — Task 11.
 *
 * The route handlers are thin: parse → call service → respond. The
 * heavy lifting (schema validation, lint, nutrition aggregation, allergen
 * union, transactional write) lives in `services/recipePersistence.ts` so
 * the same pipeline is reused by POST/PUT/extract-from-image and the apply
 * script.
 *
 * Tag visibility (spec/recipes.md "Tag Visibility"):
 *   - Public responses NEVER include `internalTags` or notes/tips/etc.
 *   - The card list filters tags via `publicTagsOf` so reserved values
 *     (meal/season/difficulty/internal) never leak.
 */
import { Router } from 'express'
import { eq, and, sql, asc, count, arrayContains, inArray } from 'drizzle-orm'
import multer from 'multer'
import crypto from 'crypto'
import { db } from '../db/connection.js'
import {
  recipes,
  recipeIngredients,
  recipeSteps,
  ingredients,
  userFavorites,
  users,
} from '../db/schema.js'
import { env } from '../config/env.js'
import {
  buildRecipePrompt,
  generateRecipeImage,
  writeRecipeImage,
  AikitNotConfiguredError,
  AikitGenerationError,
} from '../services/recipeImageGenerator.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import {
  createRecipeSchema,
  updateRecipeSchema,
  MEALS,
  SEASONS,
  DIFFICULTIES,
  type Difficulty,
  type Meal,
  type Recipe,
  type RecipeIngredient,
  type RecipeStep,
  type Season,
  type SourceType,
  type Unit,
} from '@ona/shared'
import { extractRecipeFromImage } from '../services/recipeExtractor.js'
import { AnthropicProvider } from '../services/providers/anthropic.js'
import {
  persistRecipe,
  type RecipeWriteInput,
} from '../services/recipePersistence.js'
import { scaleRecipe } from '../services/recipeScaler.js'
import {
  extractRecipeFromUrl,
  NotARecipeError,
} from '../services/recipeUrlExtractor.js'
import { NoExtractableContentError } from '../services/sources/youtube.js'
import { z } from 'zod'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    cb(null, allowed.includes(file.mimetype))
  },
})

// ─── Tag visibility helpers ───────────────────────────────────────

/** Lowercased reserved values that must never appear in public tags. */
const RESERVED_TAG_VALUES: ReadonlySet<string> = new Set<string>([
  ...MEALS.map((m) => m.toLowerCase()),
  ...SEASONS.map((s) => s.toLowerCase()),
  ...DIFFICULTIES.map((d) => d.toLowerCase()),
])

/**
 * Public-facing tag list for a recipe. Strips any tag that:
 *   - appears in `internalTags` (compartida, auto-extracted, …)
 *   - duplicates a meal / season / difficulty value (would leak in cards)
 *
 * Used by every route that returns public tags. Exported so tests and
 * the frontend can use the same filter.
 */
export function publicTagsOf(recipe: {
  tags?: string[] | null
  internalTags?: string[] | null
}): string[] {
  const tags = recipe.tags ?? []
  const internal = new Set((recipe.internalTags ?? []).map((t) => t.toLowerCase()))
  return tags.filter((t) => {
    const lower = t.toLowerCase()
    if (RESERVED_TAG_VALUES.has(lower)) return false
    if (internal.has(lower)) return false
    return true
  })
}

// ─── Card / detail shaping helpers ───────────────────────────────

interface RecipeRow {
  id: string
  name: string
  authorId: string | null
  imageUrl: string | null
  servings: number
  yieldText: string | null
  prepTime: number | null
  cookTime: number | null
  activeTime: number | null
  totalTime: number | null
  difficulty: string | null
  meals: string[]
  seasons: string[]
  equipment: string[] | null
  allergens: string[] | null
  notes: string | null
  tips: string | null
  substitutions: string | null
  storage: string | null
  nutritionPerServing: Recipe['nutritionPerServing']
  tags: string[] | null
  internalTags: string[] | null
  sourceUrl: string | null
  sourceType: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

/** Lightweight card shape per spec — used by GET /recipes. */
interface RecipeCard {
  id: string
  name: string
  imageUrl: string | null
  prepTime: number | null
  cookTime: number | null
  totalTime: number | null
  meals: Meal[]
  seasons: Season[]
  servings: number
  difficulty: Difficulty
  tags: string[]
  /** Only `kcal` is exposed on the card (per spec). */
  nutritionPerServing: { kcal: number } | null
  allergens: string[]
}

function toCard(row: RecipeRow): RecipeCard {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.imageUrl,
    prepTime: row.prepTime,
    cookTime: row.cookTime,
    totalTime: row.totalTime,
    meals: (row.meals ?? []) as Meal[],
    seasons: (row.seasons ?? []) as Season[],
    servings: row.servings,
    difficulty: ((row.difficulty as Difficulty) ?? 'medium') as Difficulty,
    tags: publicTagsOf(row),
    nutritionPerServing:
      row.nutritionPerServing && typeof row.nutritionPerServing.kcal === 'number'
        ? { kcal: row.nutritionPerServing.kcal }
        : null,
    allergens: row.allergens ?? [],
  }
}

interface IngredientRow {
  id: string
  recipeId: string
  ingredientId: string
  ingredientName: string
  section: string | null
  quantity: number
  unit: string
  optional: boolean
  note: string | null
  displayOrder: number
}

interface StepRow {
  id: string
  recipeId: string
  index: number
  text: string
  durationMin: number | null
  temperature: number | null
  technique: string | null
  ingredientRefs: string[] | null
}

function toRecipeIngredient(row: IngredientRow): RecipeIngredient {
  const out: RecipeIngredient = {
    id: row.id,
    ingredientId: row.ingredientId,
    ingredientName: row.ingredientName,
    quantity: row.quantity,
    unit: row.unit as Unit,
    optional: row.optional,
    displayOrder: row.displayOrder,
  }
  if (row.section != null) out.section = row.section
  if (row.note != null) out.note = row.note
  return out
}

function toRecipeStep(row: StepRow): RecipeStep {
  const out: RecipeStep = {
    index: row.index,
    text: row.text,
    ingredientRefs: row.ingredientRefs ?? [],
  }
  if (row.durationMin != null) out.durationMin = row.durationMin
  if (row.temperature != null) out.temperature = row.temperature
  if (row.technique != null) out.technique = row.technique
  return out
}

/** Build the public detail Recipe payload (always strips internalTags/notes/tips/...). */
function toDetailRecipe(
  row: RecipeRow,
  ings: IngredientRow[],
  steps: StepRow[],
): Recipe {
  const recipeIngredients = [...ings]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(toRecipeIngredient)
  const recipeSteps = [...steps]
    .sort((a, b) => a.index - b.index)
    .map(toRecipeStep)

  const detail: Recipe = {
    id: row.id,
    name: row.name,
    authorId: row.authorId,
    imageUrl: row.imageUrl ?? null,
    servings: row.servings,
    difficulty: ((row.difficulty as Difficulty) ?? 'medium') as Difficulty,
    meals: (row.meals ?? []) as Meal[],
    seasons: (row.seasons ?? []) as Season[],
    equipment: row.equipment ?? [],
    allergens: row.allergens ?? [],
    nutritionPerServing: row.nutritionPerServing ?? null,
    tags: publicTagsOf(row),
    internalTags: [], // never leak internalTags in public payload
    ingredients: recipeIngredients,
    steps: recipeSteps,
    createdAt: row.createdAt ?? new Date(0),
    updatedAt: row.updatedAt ?? new Date(0),
  }

  if (row.yieldText != null) detail.yieldText = row.yieldText
  if (row.prepTime != null) detail.prepTime = row.prepTime
  if (row.cookTime != null) detail.cookTime = row.cookTime
  if (row.activeTime != null) detail.activeTime = row.activeTime
  if (row.totalTime != null) detail.totalTime = row.totalTime
  if (row.sourceUrl != null) detail.sourceUrl = row.sourceUrl
  if (row.sourceType != null) detail.sourceType = row.sourceType as SourceType
  // notes/tips/substitutions/storage are intentionally NOT exposed on the
  // public detail payload — see spec "Tag Visibility" / "Display Constraints".

  return detail
}

// ─── DB read helpers ──────────────────────────────────────────────

async function fetchIngredientsForRecipes(recipeIds: string[]): Promise<IngredientRow[]> {
  if (recipeIds.length === 0) return []
  const rows = await db
    .select({
      id: recipeIngredients.id,
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      ingredientName: ingredients.name,
      section: recipeIngredients.section,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      optional: recipeIngredients.optional,
      note: recipeIngredients.note,
      displayOrder: recipeIngredients.displayOrder,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(inArray(recipeIngredients.recipeId, recipeIds))
    .orderBy(asc(recipeIngredients.displayOrder))
  return rows
}

async function fetchStepsForRecipes(recipeIds: string[]): Promise<StepRow[]> {
  if (recipeIds.length === 0) return []
  const rows = await db
    .select({
      id: recipeSteps.id,
      recipeId: recipeSteps.recipeId,
      index: recipeSteps.index,
      text: recipeSteps.text,
      durationMin: recipeSteps.durationMin,
      temperature: recipeSteps.temperature,
      technique: recipeSteps.technique,
      ingredientRefs: recipeSteps.ingredientRefs,
    })
    .from(recipeSteps)
    .where(inArray(recipeSteps.recipeId, recipeIds))
    .orderBy(asc(recipeSteps.index))
  return rows
}

async function fetchRecipeById(id: string): Promise<RecipeRow | null> {
  const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1)
  return (row as RecipeRow | undefined) ?? null
}

// ─── Routes ───────────────────────────────────────────────────────

// GET /recipes — list with filters; returns lightweight cards per spec.
router.get('/recipes', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage as string) || 20))
    const meal = req.query.meal as string | undefined
    const season = req.query.season as string | undefined
    const search = req.query.search as string | undefined
    const maxTimeRaw = req.query.maxTime as string | undefined
    const maxTime = maxTimeRaw != null ? parseInt(maxTimeRaw) : null
    const offset = (page - 1) * perPage

    const conditions = []
    if (meal) conditions.push(arrayContains(recipes.meals, [meal]))
    if (season) conditions.push(arrayContains(recipes.seasons, [season]))
    if (search) conditions.push(sql`lower(${recipes.name}) like ${`%${search.toLowerCase()}%`}`)
    if (maxTime != null && Number.isFinite(maxTime) && maxTime > 0) {
      conditions.push(sql`coalesce(${recipes.totalTime}, 999999) <= ${maxTime}`)
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [{ total }] = await db.select({ total: count() }).from(recipes).where(where)

    const rows = (await db
      .select()
      .from(recipes)
      .where(where)
      .limit(perPage)
      .offset(offset)
      .orderBy(recipes.createdAt)) as RecipeRow[]

    const cards = rows.map(toCard)

    res.set('X-Total-Count', String(total))
    res.json(cards)
  } catch (err) {
    console.error('List recipes error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /recipes/:id — single recipe with full ingredients + steps; optional ?servings=N scaling.
router.get('/recipes/:id', async (req, res) => {
  try {
    const id = String(req.params.id)
    const row = await fetchRecipeById(id)
    if (!row) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }

    const [ings, steps] = await Promise.all([
      fetchIngredientsForRecipes([id]),
      fetchStepsForRecipes([id]),
    ])

    const recipe = toDetailRecipe(row, ings, steps)

    const servingsParam = req.query.servings
    const target = servingsParam != null ? parseInt(String(servingsParam)) : null
    if (
      target != null &&
      Number.isFinite(target) &&
      target > 0 &&
      target !== recipe.servings
    ) {
      const scaled = scaleRecipe(recipe, target)
      res.json({ ...scaled, scaledFrom: scaled.scaledFrom })
      return
    }

    res.json(recipe)
  } catch (err) {
    console.error('Get recipe error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /recipes/extract-from-image — extract from photo (auth required).
router.post(
  '/recipes/extract-from-image',
  authMiddleware,
  upload.single('image'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No se ha proporcionado ninguna imagen' })
        return
      }

      const provider = new AnthropicProvider()
      const extracted = await extractRecipeFromImage(provider, req.file.buffer, req.file.mimetype)

      // Return the extracted draft so the user can review and adjust before
      // persisting through POST /recipes. Auto-persisting here would skip the
      // human-in-the-loop step and ship lint warnings the user never saw.
      res.json(extracted)
    } catch (err: any) {
      console.error('Extract recipe from image error:', err)

      if (err.message?.includes('No se pudo identificar')) {
        res.status(422).json({ error: err.message })
        return
      }
      if (err.status === 429) {
        res.status(429).json({ error: 'Demasiadas peticiones. Intenta en un momento.' })
        return
      }
      if (err.message?.includes('ANTHROPIC_API_KEY')) {
        res.status(503).json({ error: 'Servicio de IA no disponible' })
        return
      }

      res.status(500).json({ error: 'Error al analizar la imagen' })
    }
  },
)

// POST /recipes/extract-from-url — extract from a YouTube video or article URL (auth required).
const extractFromUrlSchema = z.object({ url: z.string().url() })

router.post(
  '/recipes/extract-from-url',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const parsed = extractFromUrlSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'URL inválida' })
        return
      }
      const { url } = parsed.data

      const provider = new AnthropicProvider()
      const extracted = await extractRecipeFromUrl(url, { provider })

      const writeIngredients = extracted.ingredients
        .filter((i) => i.matched && i.ingredientId)
        .map((i, idx) => ({
          ingredientId: i.ingredientId as string,
          quantity: i.quantity,
          unit: i.unit,
          displayOrder: idx,
        }))

      const writeSteps = extracted.steps.map((text, index) => ({ index, text }))

      const writeInput: RecipeWriteInput = {
        name: extracted.name,
        servings: extracted.servings ?? 2,
        prepTime: extracted.prepTime ?? null,
        cookTime: extracted.cookTime ?? null,
        difficulty: (extracted.difficulty ?? 'medium') as Difficulty,
        meals: extracted.meals,
        seasons: extracted.seasons,
        tags: extracted.tags ?? [],
        internalTags: ['auto-extracted', 'from-url'],
        sourceUrl: extracted.sourceUrl ?? url,
        sourceType: extracted.sourceType ?? null,
        ingredients: writeIngredients,
        steps: writeSteps,
      }

      const result = await persistRecipe(writeInput, {
        authorId: req.userId!,
        // URL imports go through soft lint: lint findings come back as
        // warnings instead of blocking the save. The user reviews + edits
        // on the recipe detail page.
        softLint: true,
        force: true,
      })
      if (!result.ok) {
        res.status(422).json({
          errors: result.errors,
          warnings: result.warnings,
          extracted,
        })
        return
      }

      const newRow = await fetchRecipeById(result.recipeId)
      if (!newRow) {
        res.status(500).json({ error: 'Persisted recipe not retrievable' })
        return
      }
      const [ings, steps] = await Promise.all([
        fetchIngredientsForRecipes([result.recipeId]),
        fetchStepsForRecipes([result.recipeId]),
      ])
      res.status(201).json({
        recipe: toDetailRecipe(newRow, ings, steps),
        warnings: [...result.warnings.map((w) => w.message), ...extracted.warnings],
      })
    } catch (err: any) {
      console.error('Extract recipe from URL error:', err)

      if (err instanceof NotARecipeError) {
        res.status(422).json({
          error: 'Esta URL no parece contener una receta cocinable.',
          reason: err.reason,
          isRecipe: false,
        })
        return
      }
      if (err instanceof NoExtractableContentError) {
        res.status(422).json({ error: err.message })
        return
      }
      if (err.status === 429) {
        res.status(429).json({ error: 'Demasiadas peticiones. Intenta en un momento.' })
        return
      }
      if (err.message?.includes('ANTHROPIC_API_KEY')) {
        res.status(503).json({ error: 'Servicio de IA no disponible' })
        return
      }
      if (err.message?.includes('descargar la página')) {
        res.status(502).json({ error: err.message })
        return
      }

      res.status(500).json({ error: 'Error al procesar la URL' })
    }
  },
)

// POST /recipes — create user recipe (auth required, lint-validated).
router.post(
  '/recipes',
  authMiddleware,
  validate(createRecipeSchema),
  async (req: AuthRequest, res) => {
    try {
      const body = req.body as RecipeWriteInput
      const result = await persistRecipe(body, { authorId: req.userId! })
      if (!result.ok) {
        res.status(422).json({ errors: result.errors, warnings: result.warnings })
        return
      }

      const newRow = await fetchRecipeById(result.recipeId)
      if (!newRow) {
        res.status(500).json({ error: 'Persisted recipe not retrievable' })
        return
      }
      const [ings, steps] = await Promise.all([
        fetchIngredientsForRecipes([result.recipeId]),
        fetchStepsForRecipes([result.recipeId]),
      ])
      res.status(201).json(toDetailRecipe(newRow, ings, steps))
    } catch (err) {
      console.error('Create recipe error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// PUT /recipes/:id — update (auth required, author only, lint-validated).
router.put(
  '/recipes/:id',
  authMiddleware,
  validate(updateRecipeSchema),
  async (req: AuthRequest, res) => {
    try {
      const recipeId = String(req.params.id)

      const [existing] = await db
        .select({ authorId: recipes.authorId })
        .from(recipes)
        .where(eq(recipes.id, recipeId))
        .limit(1)

      if (!existing) {
        res.status(404).json({ error: 'Recipe not found' })
        return
      }

      // System recipes (authorId === null) are read-only.
      if (existing.authorId === null) {
        res.status(403).json({ error: 'Forbidden: system recipe' })
        return
      }
      if (existing.authorId !== req.userId) {
        res.status(403).json({ error: 'Forbidden: not the author' })
        return
      }

      // updateRecipeSchema is `.partial()`; require enough fields to lint.
      // Pragmatic approach: require a full replacement payload (name + ingredients + steps).
      const body = req.body as Partial<RecipeWriteInput>
      if (
        !body.name ||
        !body.servings ||
        !body.ingredients ||
        !body.steps ||
        !body.meals
      ) {
        res.status(422).json({
          error:
            'PUT requires a complete payload (name, servings, meals, ingredients, steps)',
        })
        return
      }

      const result = await persistRecipe(body as RecipeWriteInput, {
        authorId: existing.authorId,
        recipeId,
      })
      if (!result.ok) {
        res.status(422).json({ errors: result.errors, warnings: result.warnings })
        return
      }

      const newRow = await fetchRecipeById(recipeId)
      if (!newRow) {
        res.status(500).json({ error: 'Updated recipe not retrievable' })
        return
      }
      const [ings, steps] = await Promise.all([
        fetchIngredientsForRecipes([recipeId]),
        fetchStepsForRecipes([recipeId]),
      ])
      res.json(toDetailRecipe(newRow, ings, steps))
    } catch (err) {
      console.error('Update recipe error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// POST /recipes/:id/copy — copy a recipe into the user's catalog (auth required).
// Used to "Añadir a mis recetas" from the ONA system catalog. Creates a new
// `recipes` row with `authorId = req.userId` and clones every
// `recipe_ingredients` and `recipe_steps` row. `step.ingredientRefs` UUIDs
// are remapped from the source rows to the freshly-minted ones so step → ingredient
// links stay valid in the copy. The user can edit the copy freely without
// affecting the source.
router.post('/recipes/:id/copy', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const sourceId = String(req.params.id)

    const [source] = await db
      .select()
      .from(recipes)
      .where(eq(recipes.id, sourceId))
      .limit(1)
    if (!source) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }

    // Refuse silently if the user already owns this very row (we'd dup their
    // own recipe). Copying someone else's user recipe is fine — it becomes
    // theirs from then on.
    if (source.authorId === req.userId) {
      res.status(409).json({ error: 'Esta receta ya es tuya.' })
      return
    }

    const sourceIngredients = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, sourceId))
      .orderBy(asc(recipeIngredients.displayOrder))

    const sourceSteps = await db
      .select()
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, sourceId))
      .orderBy(asc(recipeSteps.index))

    // Pre-mint new ingredient row ids and build the old→new map so we can
    // rewrite `step.ingredientRefs`.
    const ingRowIdMap = new Map<string, string>()
    for (const ing of sourceIngredients) {
      ingRowIdMap.set(ing.id, crypto.randomUUID())
    }

    const baseInternalTags = (source.internalTags ?? []).filter(
      (t) => t !== 'compartida' && t !== 'auto-extracted' && t !== 'from-url',
    )
    baseInternalTags.push('copied-from-catalog')

    const newRecipeId = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(recipes)
        .values({
          name: source.name,
          authorId: req.userId!,
          imageUrl: source.imageUrl,
          servings: source.servings,
          yieldText: source.yieldText,
          prepTime: source.prepTime,
          cookTime: source.cookTime,
          activeTime: source.activeTime,
          totalTime: source.totalTime,
          difficulty: source.difficulty ?? 'medium',
          meals: source.meals ?? [],
          seasons: source.seasons ?? [],
          equipment: source.equipment ?? [],
          allergens: source.allergens ?? [],
          notes: source.notes,
          tips: source.tips,
          substitutions: source.substitutions,
          storage: source.storage,
          nutritionPerServing: source.nutritionPerServing,
          tags: source.tags ?? [],
          internalTags: baseInternalTags,
          sourceUrl: source.sourceUrl,
          // The COPY's provenance is "manual" (user-owned). The fact that it
          // came from the catalog is captured in `internalTags`.
          sourceType: 'manual',
        })
        .returning({ id: recipes.id })

      if (sourceIngredients.length > 0) {
        await tx.insert(recipeIngredients).values(
          sourceIngredients.map((ing, i) => ({
            id: ingRowIdMap.get(ing.id)!,
            recipeId: inserted.id,
            ingredientId: ing.ingredientId,
            section: ing.section,
            quantity: ing.quantity,
            unit: ing.unit,
            optional: ing.optional,
            note: ing.note,
            displayOrder: ing.displayOrder ?? i,
          })),
        )
      }

      if (sourceSteps.length > 0) {
        await tx.insert(recipeSteps).values(
          sourceSteps.map((s) => ({
            recipeId: inserted.id,
            index: s.index,
            text: s.text,
            durationMin: s.durationMin,
            temperature: s.temperature,
            technique: s.technique,
            ingredientRefs: (s.ingredientRefs ?? []).map(
              (oldId: string) => ingRowIdMap.get(oldId) ?? oldId,
            ),
          })),
        )
      }

      return inserted.id
    })

    const newRow = await fetchRecipeById(newRecipeId)
    if (!newRow) {
      res.status(500).json({ error: 'Copied recipe not retrievable' })
      return
    }
    const [ings, steps] = await Promise.all([
      fetchIngredientsForRecipes([newRecipeId]),
      fetchStepsForRecipes([newRecipeId]),
    ])
    res.status(201).json(toDetailRecipe(newRow, ings, steps))
  } catch (err) {
    console.error('Copy recipe error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /recipes/:id — delete (auth required, author only).
// Cascades to recipe_ingredients and recipe_steps via FK ON DELETE CASCADE.
router.delete('/recipes/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.id)

    const [existing] = await db
      .select({ authorId: recipes.authorId })
      .from(recipes)
      .where(eq(recipes.id, recipeId))
      .limit(1)

    if (!existing) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }

    if (existing.authorId === null) {
      res.status(403).json({ error: 'Forbidden: system recipe' })
      return
    }
    if (existing.authorId !== req.userId) {
      res.status(403).json({ error: 'Forbidden: not the author' })
      return
    }

    await db.delete(recipes).where(eq(recipes.id, recipeId))

    res.status(204).send()
  } catch (err) {
    console.error('Delete recipe error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /recipes/:id/regenerate-image — author-only AI hero photo (auth required).
//
// Quota model (per-user, monthly): each user has `image_gen_month_key` (the
// YYYY-MM the count belongs to) and `image_gen_count`. We do a single atomic
// UPDATE that bumps the count only if the user is under the limit for the
// current month — when the month rolls over the count resets to 1 implicitly.
// If the AiKit call fails *after* we bumped the quota, we decrement so the
// failed attempt doesn't burn one of the user's 20 monthly slots.
router.post(
  '/recipes/:id/regenerate-image',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const recipeId = String(req.params.id)
      const userId = req.userId!

      // 1. Lookup the recipe + verify ownership.
      const [recipe] = await db
        .select({
          id: recipes.id,
          name: recipes.name,
          authorId: recipes.authorId,
          meals: recipes.meals,
        })
        .from(recipes)
        .where(eq(recipes.id, recipeId))
        .limit(1)

      if (!recipe) {
        res.status(404).json({ error: 'Recipe not found' })
        return
      }
      if (recipe.authorId !== userId) {
        // System recipes (authorId null) and other users' recipes both fall here.
        res.status(403).json({ error: 'Solo el autor puede regenerar la imagen' })
        return
      }

      if (!env.AIKIT_API_KEY) {
        res.status(503).json({ error: 'Generación de imágenes no configurada' })
        return
      }

      // 2. Atomic quota bump. Returns the new count if the user was under the
      //    limit; returns no rows if they were already at it (or over).
      const monthKey = new Date().toISOString().slice(0, 7) // 'YYYY-MM'
      const limit = env.IMAGE_GEN_MONTHLY_LIMIT
      const bumped = await db.execute(sql`
        UPDATE users SET
          image_gen_count = CASE
            WHEN image_gen_month_key = ${monthKey} THEN image_gen_count + 1
            ELSE 1
          END,
          image_gen_month_key = ${monthKey}
        WHERE id = ${userId}::uuid AND (
          image_gen_month_key IS DISTINCT FROM ${monthKey}
          OR image_gen_count < ${limit}
        )
        RETURNING image_gen_count
      `)
      const newCount = (bumped.rows[0] as { image_gen_count: number } | undefined)?.image_gen_count
      if (newCount == null) {
        res.status(429).json({
          error: 'Has alcanzado tu límite mensual de imágenes generadas con IA',
          quota: { used: limit, limit, monthKey },
        })
        return
      }

      // 3. Pull the recipe's top ingredients for the prompt. Best-effort —
      //    if the recipe has no ingredients we still generate something.
      const ingRows = await db
        .select({
          name: ingredients.name,
          displayOrder: recipeIngredients.displayOrder,
        })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
        .where(eq(recipeIngredients.recipeId, recipeId))
        .orderBy(asc(recipeIngredients.displayOrder))
        .limit(4)

      const prompt = buildRecipePrompt({
        name: recipe.name,
        topIngredients: ingRows.map((r) => r.name),
        meals: recipe.meals ?? [],
      })

      // 4. Call AiKit + persist. If anything goes wrong we refund the quota
      //    so the user doesn't lose a slot to a transient failure.
      try {
        const png = await generateRecipeImage(prompt, '4:3')
        const { imageUrl } = await writeRecipeImage(png, `${recipeId}.jpg`)

        await db
          .update(recipes)
          .set({ imageUrl, updatedAt: new Date() })
          .where(eq(recipes.id, recipeId))

        res.json({
          imageUrl,
          quota: { used: newCount, limit, monthKey },
        })
      } catch (genErr) {
        // Refund the quota slot — same conditional shape so we don't go
        // negative if the user happens to call again concurrently.
        await db.execute(sql`
          UPDATE users SET image_gen_count = GREATEST(image_gen_count - 1, 0)
          WHERE id = ${userId}::uuid AND image_gen_month_key = ${monthKey}
        `)
        if (genErr instanceof AikitNotConfiguredError) {
          res.status(503).json({ error: 'Generación de imágenes no configurada' })
        } else if (genErr instanceof AikitGenerationError) {
          console.error('AiKit gen failed:', genErr)
          res.status(502).json({ error: 'El servicio de imágenes falló. Inténtalo de nuevo.' })
        } else {
          throw genErr
        }
      }
    } catch (err) {
      console.error('regenerate-image error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// GET /user/:id/recipes — user's own recipes + favorited recipes (cards).
router.get('/user/:id/recipes', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.id)

    const ownRows = (await db
      .select()
      .from(recipes)
      .where(eq(recipes.authorId, userId))
      .orderBy(recipes.createdAt)) as RecipeRow[]

    const favRows = (await db
      .select({
        id: recipes.id,
        name: recipes.name,
        authorId: recipes.authorId,
        imageUrl: recipes.imageUrl,
        servings: recipes.servings,
        yieldText: recipes.yieldText,
        prepTime: recipes.prepTime,
        cookTime: recipes.cookTime,
        activeTime: recipes.activeTime,
        totalTime: recipes.totalTime,
        difficulty: recipes.difficulty,
        meals: recipes.meals,
        seasons: recipes.seasons,
        equipment: recipes.equipment,
        allergens: recipes.allergens,
        notes: recipes.notes,
        tips: recipes.tips,
        substitutions: recipes.substitutions,
        storage: recipes.storage,
        nutritionPerServing: recipes.nutritionPerServing,
        tags: recipes.tags,
        internalTags: recipes.internalTags,
        sourceUrl: recipes.sourceUrl,
        sourceType: recipes.sourceType,
        createdAt: recipes.createdAt,
        updatedAt: recipes.updatedAt,
      })
      .from(userFavorites)
      .innerJoin(recipes, eq(userFavorites.recipeId, recipes.id))
      .where(eq(userFavorites.userId, userId))) as RecipeRow[]

    res.json({
      own: ownRows.map(toCard),
      favorites: favRows.map(toCard),
    })
  } catch (err) {
    console.error('Get user recipes error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /user/:id/recipes/:recipeId/favorite — toggle favorite.
router.post(
  '/user/:id/recipes/:recipeId/favorite',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (req.userId !== String(req.params.id)) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }

      const userId = String(req.params.id)
      const recipeId = String(req.params.recipeId)

      const [recipe] = await db
        .select({ id: recipes.id })
        .from(recipes)
        .where(eq(recipes.id, recipeId))
        .limit(1)

      if (!recipe) {
        res.status(404).json({ error: 'Recipe not found' })
        return
      }

      const [existing] = await db
        .select({ id: userFavorites.id })
        .from(userFavorites)
        .where(and(eq(userFavorites.userId, userId), eq(userFavorites.recipeId, recipeId)))
        .limit(1)

      if (existing) {
        await db
          .delete(userFavorites)
          .where(and(eq(userFavorites.userId, userId), eq(userFavorites.recipeId, recipeId)))
        res.json({ favorited: false })
      } else {
        await db.insert(userFavorites).values({ userId, recipeId })
        res.json({ favorited: true })
      }
    } catch (err) {
      console.error('Toggle favorite error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

export default router
