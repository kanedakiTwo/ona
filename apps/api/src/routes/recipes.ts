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
import { Router, type NextFunction, type Response } from 'express'
import { eq, and, sql, asc, count, arrayContains, inArray, isNull, notInArray } from 'drizzle-orm'
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
  recipeNotes,
} from '../db/schema.js'
import { env } from '../config/env.js'
import {
  buildRecipePrompt,
  generateRecipeImage,
  imageGenerationConfigured,
  writeRecipeImage,
  AikitNotConfiguredError,
  AikitGenerationError,
} from '../services/recipeImageGenerator.js'
import { loadDish, makeHouseImage, scheduleHouseImage } from '../services/recipeHouseImage.js'
import {
  OWN_IMAGE_MAX_BYTES,
  UnreadableImageError,
  canChangeRecipeImage,
  isAcceptedImageType,
  saveOwnRecipeImage,
} from '../services/recipeOwnImage.js'
import { recipeShoppingIssues } from '../services/recipeShoppability.js'
import {
  authMiddleware,
  optionalAuthMiddleware,
  type AuthRequest,
} from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import {
  createRecipeSchema,
  updateRecipeSchema,
  MEALS,
  SEASONS,
  DIFFICULTIES,
  RETIRED_RECIPE_TAG,
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
import { sortCatalog, type CatalogOrderRow } from '../services/recipeCatalogOrder.js'
import { saveExtractedRecipe } from '../services/recipeImport.js'
import { AnthropicProvider } from '../services/providers/anthropic.js'
import { runWithCostUser } from '../services/costLedger.js'
import {
  persistRecipe,
  type RecipeWriteInput,
} from '../services/recipePersistence.js'
import { scaleRecipe } from '../services/recipeScaler.js'
import {
  extractRecipeFromUrl,
  NotARecipeError,
  SocialCaptionUnavailableError,
} from '../services/recipeUrlExtractor.js'
import { NoExtractableContentError } from '../services/sources/youtube.js'
import { PageFetchError, UnsafeUrlError } from '../services/net/publicFetch.js'
import { getPrimaryHouseholdId, resolveScope, scopeWhere } from '../services/scopeResolver.js'
import { sanitizeCustomTags } from '../services/recipeNotesStore.js'
import { findPantryMatches } from '../services/pantryMatcher.js'
import { chosenFromIds, findRecipesWithWhatIHave, loadUserRestrictions, MAX_CHOSEN_INGREDIENTS } from '../services/withWhatIHave.js'
import { loadMatchableRecipes } from '../services/matchableRecipes.js'
import { recipeIdsBreakingRestrictions } from '../services/dietaryRestrictions.js'
import { effectiveAllergens } from '../services/nutrition/allergens.js'
import { canViewRecipe, isHiddenDraft, PUBLISHED } from '../services/recipeVisibility.js'
import { requestCatalogPhotos } from '../services/catalogImageOnDemand.js'
import { z } from 'zod'
import { requireSpendCapacity } from '../middleware/spendCap.js'
import { requireRecipeId } from '../middleware/recipeId.js'

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
  /** 'draft' | 'published' (PRO-154): catalogue drafts open only for admins. */
  status?: string | null
  imageUrl: string | null
  servings: number
  /** DB column added in PR 2 migration; absent on pre-migration rows — default 'explicit'. */
  servingsConfidence?: 'explicit' | 'estimated' | null
  yieldText: string | null
  prepTime: number | null
  cookTime: number | null
  activeTime: number | null
  totalTime: number | null
  difficulty: string | null
  meals: string[]
  seasons: string[]
  mealFit: Record<string, 'mid' | 'perfect'> | null
  seasonFit: Record<string, 'mid' | 'perfect'> | null
  frequency: 'frequent' | 'normal' | 'occasional' | 'weekends_only' | null
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
  /** Null for system / Mimoia-curated recipes; the owning user's id otherwise.
   * The frontend uses this for the scope chips ("Selección Mimoia" /
   * "Mis recetas"; none = todas).
   * Omitting it (the previous behaviour) made every card look authorless
   * to the page logic — badge said Mimoia but the old "Catálogo Mimoia" filter
   * found 0 results, and "Mis recetas" was always empty. */
  authorId: string | null
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
    authorId: row.authorId,
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
  displayQuantity: number | null
  displayUnit: string | null
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
  if (row.displayQuantity != null) out.displayQuantity = row.displayQuantity
  if (row.displayUnit != null) out.displayUnit = row.displayUnit
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
    servingsConfidence: row.servingsConfidence ?? 'explicit',
    difficulty: ((row.difficulty as Difficulty) ?? 'medium') as Difficulty,
    meals: (row.meals ?? []) as Meal[],
    seasons: (row.seasons ?? []) as Season[],
    // Three-state fit maps. Legacy rows (created before migration 0024)
    // have null in the column — fall back to "every listed entry is
    // 'perfect'" so the matcher and UI see consistent shape regardless of
    // when the recipe was authored. Re-saving the recipe overwrites with
    // the user-chosen values.
    mealFit: (row.mealFit as Record<string, 'mid' | 'perfect'> | null) ??
      Object.fromEntries(((row.meals ?? []) as string[]).map((m) => [m, 'perfect'])),
    seasonFit: (row.seasonFit as Record<string, 'mid' | 'perfect'> | null) ??
      Object.fromEntries(((row.seasons ?? []) as string[]).map((s) => [s, 'perfect'])),
    frequency: row.frequency ?? null,
    equipment: row.equipment ?? [],
    // Stored union + what the ingredient names say today (PRO-61): fixes
    // stale unions like «Harina de fuerza» without gluten, with no DB write.
    allergens: effectiveAllergens(row.allergens, ings.map((i) => i.ingredientName)),
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
      displayQuantity: recipeIngredients.displayQuantity,
      displayUnit: recipeIngredients.displayUnit,
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
// Public catalogue: anonymous callers (no Bearer token) see ONLY system
// recipes (`authorId IS NULL`). Authenticated callers keep the existing
// behaviour and see the full catalogue — the frontend then segments by
// scope (todas / Mis recetas / Selección Mimoia) per spec.
router.get('/recipes', optionalAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage as string) || 20))
    const meal = req.query.meal as string | undefined
    const season = req.query.season as string | undefined
    const search = req.query.search as string | undefined
    const maxTimeRaw = req.query.maxTime as string | undefined
    const maxTime = maxTimeRaw != null ? parseInt(maxTimeRaw) : null
    // PR 8B-2: filter by custom-tag — only for authed callers (anonymous
    // catalogue has no household scope). Accepts a single ?customTag=
    // or repeated ?customTag=a&customTag=b (intersection).
    const rawCustomTags = req.query.customTag
    const customTagsList = Array.isArray(rawCustomTags)
      ? (rawCustomTags as unknown[])
      : rawCustomTags != null
        ? [rawCustomTags as unknown]
        : []
    const customTags = sanitizeCustomTags(customTagsList)
    // ?fitsMe=1 (PRO-61): hide recipes that break the caller's allergies or
    // diet (profile + memory; dislikes are not applied — an explicit pick may
    // override a dislike, never an allergy). Used by the menu's «Elegir otra
    // receta» picker. Anonymous callers: ignored.
    const fitsMe = req.query.fitsMe === '1' || req.query.fitsMe === 'true'
    const offset = (page - 1) * perPage

    const conditions = []
    // Catalogue drafts (PRO-154) never list, not even for admins.
    conditions.push(eq(recipes.status, PUBLISHED))
    // Visibility rules:
    //   - Anonymous: system recipes only.
    //   - Authenticated user (incl. admin): system recipes + their own.
    //     Other users' recipes are NEVER returned through this listing.
    //   - If the user has a personal copy of a system recipe (back-ref via
    //     `copied_from_recipe_id`), hide the original so the catalogue
    //     doesn't show two entries for the same dish.
    if (!req.userId) {
      conditions.push(isNull(recipes.authorId))
    } else {
      conditions.push(
        sql`(${recipes.authorId} IS NULL OR ${recipes.authorId} = ${req.userId})`,
      )
      conditions.push(sql`NOT EXISTS (
        SELECT 1 FROM ${recipes} AS copy
        WHERE copy.author_id = ${req.userId}
          AND copy.copied_from_recipe_id = ${recipes.id}
      )`)
    }
    if (meal) conditions.push(arrayContains(recipes.meals, [meal]))
    if (season) conditions.push(arrayContains(recipes.seasons, [season]))
    if (search) conditions.push(sql`lower(${recipes.name}) like ${`%${search.toLowerCase()}%`}`)
    if (maxTime != null && Number.isFinite(maxTime) && maxTime > 0) {
      conditions.push(sql`coalesce(${recipes.totalTime}, 999999) <= ${maxTime}`)
    }
    if (req.userId && customTags.length > 0) {
      const householdId = await getPrimaryHouseholdId(req.userId)
      if (householdId) {
        // Inner-join semantics via a correlated subquery: keep recipes
        // whose recipe_notes row in this household contains every
        // requested tag. We hand-build the ARRAY[...] literal so each
        // entry is a bound parameter (sql tag would otherwise serialize
        // the JS array as a single string and Postgres throws
        // "malformed array literal").
        const tagsArr = sql`ARRAY[${sql.join(customTags.map((t) => sql`${t}`), sql`, `)}]::text[]`
        conditions.push(sql`EXISTS (
          SELECT 1 FROM ${recipeNotes}
          WHERE ${recipeNotes.recipeId} = ${recipes.id}
            AND ${recipeNotes.householdId} = ${householdId}
            AND ${recipeNotes.customTags} @> ${tagsArr}
        )`)
      } else {
        // No household, no tags can match — return empty result.
        conditions.push(sql`FALSE`)
      }
    }
    if (req.userId && fitsMe) {
      const { restrictions } = await loadUserRestrictions(req.userId, db)
      if (restrictions.length > 0) {
        const excluded = recipeIdsBreakingRestrictions(await loadMatchableRecipes(req.userId, db), restrictions)
        if (excluded.length > 0) conditions.push(notInArray(recipes.id, excluded))
      }
    }
    // Retired catalogue recipes (PRO-140) never list; they still open by id.
    conditions.push(sql`NOT (${recipes.authorId} IS NULL AND ${RETIRED_RECIPE_TAG} = ANY(coalesce(${recipes.internalTags}, ARRAY[]::text[])))`)
    const where = conditions.length > 0 ? and(...conditions) : undefined

    // Order (PRO-140, services/recipeCatalogOrder.ts): households with it in
    // favourites, then Miguel's featured list, then oldest first. The
    // catalogue is small, so the order is computed over the matching ids and
    // only the page's rows are loaded.
    const orderRows = (await db
      .select({
        id: recipes.id,
        name: recipes.name,
        createdAt: recipes.createdAt,
        // Raw, table-qualified SQL: drizzle prints bare column names in a
        // one-table select, and a bare "id" would bind to user_favorites.
        favoriteHouseholds: sql<number>`(SELECT count(DISTINCT coalesce(uf.household_id, uf.user_id)) FROM user_favorites uf WHERE uf.recipe_id = "recipes"."id")::int`,
      })
      .from(recipes)
      .where(where)) as CatalogOrderRow[]
    const total = orderRows.length
    const pageIds = sortCatalog(orderRows.map((r) => ({ ...r, favoriteHouseholds: Number(r.favoriteHouseholds) })))
      .slice(offset, offset + perPage)
      .map((r) => r.id)

    const pageRows = pageIds.length
      ? ((await db.select().from(recipes).where(inArray(recipes.id, pageIds))) as RecipeRow[])
      : []
    const byId = new Map(pageRows.map((r) => [r.id, r]))
    const rows = pageIds.map((id) => byId.get(id)).filter((r): r is RecipeRow => r != null)

    const cards = rows.map(toCard)

    res.set('X-Total-Count', String(total))
    res.json(cards)
  } catch (err) {
    console.error('List recipes error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /recipes/match-pantry?limit=N — cook-from-pantry suggestions (PR 12).
// Auth-only. Ranks every catalogue recipe by what fraction of its required
// ingredients the caller's household already has at home. Returns the top
// `limit` (default 3, max 20) sorted by coverage desc. **Must be declared
// before `/recipes/:id`** so the more-specific path matches first.
router.get('/recipes/match-pantry', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const limitRaw = parseInt(String(req.query.limit ?? '3'), 10)
    const limit = Math.min(20, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 3))
    const matches = await findPantryMatches(req.userId!, limit)
    res.json(matches)
  } catch (err) {
    console.error('GET /recipes/match-pantry error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /recipes/with-what-i-have?ingredient=<id>[&ingredient=<id>…] — «Con lo
// que tengo» (PRO-31). Auth-only. 1–3 catalogue ingredient ids → visible
// recipes (catalogue + the household's own) that use them, ranked by how many
// they use, each with what's missing (basics and optional ones never count).
// Allergies, diet and dislikes filter like the assistant's suggest_recipes.
// **Must be declared before `/recipes/:id`.**
router.get('/recipes/with-what-i-have', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const raw = req.query.ingredient
    const ids = (Array.isArray(raw) ? raw : raw != null ? [raw] : [])
      .map((v) => String(v).trim())
      .filter((v) => /^[0-9a-f-]{36}$/i.test(v))
    if (ids.length === 0) {
      res.status(400).json({ error: 'Elige al menos un ingrediente' })
      return
    }
    if (new Set(ids).size > MAX_CHOSEN_INGREDIENTS) {
      res.status(400).json({ error: `Elige como mucho ${MAX_CHOSEN_INGREDIENTS} ingredientes` })
      return
    }
    const chosen = await chosenFromIds(ids)
    const hits = await findRecipesWithWhatIHave(req.userId!, chosen)
    res.json(hits.map((h) => ({ ...toCard(h.recipe.row as RecipeRow), uses: h.uses, missing: h.missing })))
  } catch (err) {
    console.error('GET /recipes/with-what-i-have error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /recipes/:id — single recipe with full ingredients + steps; optional ?servings=N scaling.
// Anonymous callers can only fetch system recipes (`authorId IS NULL`);
// requesting another user's recipe returns 404 (same shape as "not found"
// so we don't leak the existence of private recipes).
router.get('/recipes/:id', requireRecipeId(), optionalAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id)
    const row = await fetchRecipeById(id)
    if (!row) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }
    // User recipes: only the author and their household (404, not 403, so we
    // don't confirm that a private recipe exists).
    if (!(await canViewRecipe(req.userId, row.authorId))) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }
    // A catalogue draft (PRO-154) opens only for an admin (the review sample).
    if (isHiddenDraft(row, req.user?.role === 'admin')) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }
    // First time a catalogue recipe without a photo is opened → make it.
    requestCatalogPhotos([row])

    const [ings, steps] = await Promise.all([
      fetchIngredientsForRecipes([id]),
      fetchStepsForRecipes([id]),
    ])

    const recipe = toDetailRecipe(row, ings, steps)
    // "¿Se puede comprar?" — for whoever can fix the recipe.
    if (req.userId && (row.authorId === req.userId || req.user?.role === 'admin')) {
      recipe.shoppingIssues = recipeShoppingIssues(
        ings.map((i) => ({ id: i.id, name: i.ingredientName, quantity: i.quantity, unit: i.unit as Unit, note: i.note, optional: i.optional })),
      )
    }

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
  requireSpendCapacity(),
  upload.single('image'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No se ha proporcionado ninguna imagen' })
        return
      }

      const provider = new AnthropicProvider()
      // multer's stream callbacks drop authMiddleware's cost context; re-enter
      // it so the vision call is billed to this user in the cost ledger.
      const file = req.file
      const extracted = await runWithCostUser(req.userId ?? null, () =>
        extractRecipeFromImage(provider, file.buffer, file.mimetype),
      )

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
// `asSystem: true` (admin-only) lands the recipe in the curated Mimoia catalogue
// (`authorId = null`, `internalTags` includes `compartida`) so it shows up
// under "Selección Mimoia" on /recipes and in the public catalogue (/recipes signed out).
// Non-admins requesting asSystem get 403.
const extractFromUrlSchema = z.object({
  url: z.string().url(),
  asSystem: z.boolean().optional(),
})

router.post(
  '/recipes/extract-from-url',
  authMiddleware,
  requireSpendCapacity(),
  async (req: AuthRequest, res) => {
    try {
      const parsed = extractFromUrlSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'URL inválida' })
        return
      }
      const { url, asSystem } = parsed.data

      if (asSystem && req.user?.role !== 'admin') {
        res.status(403).json({
          error: 'Sólo los administradores pueden añadir al catálogo Mimoia.',
          code: 'NOT_ADMIN',
        })
        return
      }

      const provider = new AnthropicProvider()
      const extracted = await extractRecipeFromUrl(url, { provider })

      // System imports get the `compartida` flag so the existing
      // `publicTagsOf` filter hides it from cards (matches the seed pipeline
      // convention). `from-url` + `auto-extracted` mark provenance regardless
      // of catalogue scope.
      const result = await saveExtractedRecipe(extracted, {
        // asSystem: persist as a curated Mimoia recipe (authorId = null) so it
        // surfaces in the public catalogue and under "Selección Mimoia" on /recipes.
        authorId: asSystem ? null : req.userId!,
        internalTags: asSystem
          ? ['compartida', 'auto-extracted', 'from-url']
          : ['auto-extracted', 'from-url'],
        sourceUrl: url,
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
        warnings: result.warnings,
      })
    } catch (err: any) {
      console.error('Extract recipe from URL error:', err)

      // Instagram / TikTok post whose caption doesn't hold the recipe:
      // plan B is a screenshot (photo import). Same sentence as WhatsApp.
      if (err instanceof SocialCaptionUnavailableError) {
        res.status(422).json({ error: err.message, code: 'NEEDS_SCREENSHOT' })
        return
      }
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
      // SSRF guard (services/net/publicFetch.ts): localhost, private ranges…
      if (err instanceof UnsafeUrlError) {
        res.status(400).json({ error: err.message })
        return
      }
      if (err instanceof PageFetchError) {
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
// `?force=1` (or body `force: true`) downgrades lint errors to warnings,
// persists the recipe, and returns it with `warnings` on the response. The
// `/recipes/new` form uses this two-step: first attempt strict so the user
// sees inline hints, then "Guardar igualmente" re-submits with force=1.
router.post(
  '/recipes',
  authMiddleware,
  validate(createRecipeSchema),
  async (req: AuthRequest, res) => {
    try {
      const body = req.body as RecipeWriteInput
      const force = req.query.force === '1' || (req.body && (req.body as { force?: unknown }).force === true)
      const result = await persistRecipe(body, {
        authorId: req.userId!,
        softLint: force,
      })
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
      // Surface the soft-lint warnings so the client can show them on the
      // detail page or via a banner even after a successful save.
      const warnings = result.warnings.map((w) => ({
        code: w.code,
        message: w.message,
        path: w.path,
      }))
      // No photo (or a pasted external URL) → house-style photo in the background,
      // unless the author is about to upload their own (`?ownPhoto=1`, PRO-145:
      // the form sends the file right after this answers).
      const ownPhoto = req.query.ownPhoto === '1'
      scheduleHouseImage(result.recipeId, req.userId!, { isAdmin: req.user?.role === 'admin', currentUrl: body.imageUrl, ownPhoto })
      res.status(201).json({
        ...toDetailRecipe(newRow, ings, steps),
        warnings,
      })
    } catch (err) {
      console.error('Create recipe error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// PUT /recipes/:id — update (auth required, author only, lint-validated).
router.put(
  '/recipes/:id',
  requireRecipeId(),
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

      // System recipes (authorId === null) and recipes owned by another user
      // are normally read-only — except for admins, who can curate the whole
      // catalogue (fixing typos, adding missing steps to Mimoia recipes, etc.).
      const isAdmin = req.user?.role === 'admin'
      if (existing.authorId === null && !isAdmin) {
        res.status(403).json({ error: 'Forbidden: system recipe' })
        return
      }
      if (existing.authorId !== null && existing.authorId !== req.userId && !isAdmin) {
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

      // Mirror the POST flow: `?force=1` (or body `force: true`) downgrades
      // lint errors to advisory warnings so the user can save a recipe with
      // out-of-range quantities or unbound step references after one round
      // of feedback. The edit UI shows the warnings as "Avisos" and exposes
      // a "Guardar igualmente" submitter.
      const force =
        req.query.force === '1' ||
        (req.body && (req.body as { force?: unknown }).force === true)
      const result = await persistRecipe(body as RecipeWriteInput, {
        authorId: existing.authorId,
        recipeId,
        softLint: force,
        // The edit form doesn't carry the hero image URL — that field is
        // managed out-of-band by the "Regenerar imagen" button (which writes
        // directly to `recipes.image_url`). Without this flag a regular
        // "Guardar cambios" wipes the image on save because input.imageUrl
        // is undefined → null. Author-only edits should always preserve.
        preserveExistingImage: true,
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
// Used to "Añadir a mis recetas" from the Mimoia system catalog. Creates a new
// `recipes` row with `authorId = req.userId` and clones every
// `recipe_ingredients` and `recipe_steps` row. `step.ingredientRefs` UUIDs
// are remapped from the source rows to the freshly-minted ones so step → ingredient
// links stay valid in the copy. The user can edit the copy freely without
// affecting the source.
router.post('/recipes/:id/copy', requireRecipeId(), authMiddleware, async (req: AuthRequest, res) => {
  try {
    const sourceId = String(req.params.id)

    const [source] = await db
      .select()
      .from(recipes)
      .where(eq(recipes.id, sourceId))
      .limit(1)
    if (!source || isHiddenDraft(source, req.user?.role === 'admin')) {
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
          // Back-reference to the original — used by the catalogue list to
          // hide the source from this user (they already have their own).
          copiedFromRecipeId: source.id,
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
router.delete('/recipes/:id', requireRecipeId(), authMiddleware, async (req: AuthRequest, res) => {
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

    // Admins can delete any recipe (including system ones); everyone else
    // is restricted to the rows they authored.
    const isAdmin = req.user?.role === 'admin'
    if (existing.authorId === null && !isAdmin) {
      res.status(403).json({ error: 'Forbidden: system recipe' })
      return
    }
    if (existing.authorId !== null && existing.authorId !== req.userId && !isAdmin) {
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

/** Give back an image slot — same conditional shape so it never goes negative. */
async function refundImageQuota(userId: string, monthKey: string): Promise<void> {
  await db.execute(sql`
    UPDATE users SET image_gen_count = GREATEST(image_gen_count - 1, 0)
    WHERE id = ${userId}::uuid AND image_gen_month_key = ${monthKey}
  `)
}

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
  requireRecipeId(),
  authMiddleware,
  requireSpendCapacity(),
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
      // Authors regenerate their own recipes; admins curate the catalogue
      // (system recipes + others' recipes). Everyone else is rejected.
      const isAdmin = req.user?.role === 'admin'
      if (recipe.authorId !== userId && !isAdmin) {
        res.status(403).json({ error: 'Solo el autor puede regenerar la imagen' })
        return
      }

      if (!imageGenerationConfigured()) {
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

      // 3+4. Describe the plated dish → generate in the house style → vision
      //      check (one more try on a miss) → persist. If anything goes wrong
      //      we refund the quota so the user doesn't lose a slot to it.
      try {
        const dish = await loadDish(recipeId)
        const made = dish ? await makeHouseImage(dish) : null
        if (!made?.png) {
          await refundImageQuota(userId, monthKey)
          res.status(502).json({ error: 'La imagen no ha salido bien. Inténtalo de nuevo.' })
          return
        }
        const { imageUrl } = await writeRecipeImage(made.png, `${recipeId}.jpg`)

        await db
          .update(recipes)
          .set({ imageUrl, updatedAt: new Date() })
          .where(eq(recipes.id, recipeId))

        res.json({
          imageUrl,
          quota: { used: newCount, limit, monthKey },
        })
      } catch (genErr) {
        await refundImageQuota(userId, monthKey)
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

// POST /recipes/:id/upload-image — "Subir mi foto": the author's (or an
// admin's) own photo as the main one (PRO-145, specs/recipe-images.md →
// "Own photo"). EXIF-rotated, centre-cropped to 4:3, ≤ 1200 px JPEG on the
// volume. Costs nothing and does NOT touch the monthly AI image quota.
// 413 over 10 MB, 415 for a format we can't read, 403 for anyone else.
const ownImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: OWN_IMAGE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isAcceptedImageType(file.mimetype)) cb(null, true)
    else cb(new UnsupportedImageTypeError())
  },
})

class UnsupportedImageTypeError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function receiveOwnImage(req: AuthRequest, res: Response, next: NextFunction) {
  ownImageUpload.single('image')(req, res, (err: unknown) => {
    if (!err) return next()
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'La foto pesa más de 10 MB. Elige otra o redúcela.' })
      return
    }
    if (err instanceof UnsupportedImageTypeError) {
      res.status(415).json({ error: 'Formato no admitido. Sube una foto JPG, PNG, WebP o HEIC.' })
      return
    }
    next(err)
  })
}

router.post(
  '/recipes/:id/upload-image',
  requireRecipeId(),
  authMiddleware,
  receiveOwnImage,
  async (req: AuthRequest, res) => {
    try {
      const recipeId = String(req.params.id)
      if (!UUID_RE.test(recipeId)) {
        res.status(404).json({ error: 'Recipe not found' })
        return
      }
      const [recipe] = await db
        .select({ authorId: recipes.authorId })
        .from(recipes)
        .where(eq(recipes.id, recipeId))
        .limit(1)
      if (!recipe) {
        res.status(404).json({ error: 'Recipe not found' })
        return
      }
      if (!canChangeRecipeImage(recipe.authorId, { userId: req.userId!, isAdmin: req.user?.role === 'admin' })) {
        res.status(403).json({ error: 'Solo el autor o un admin pueden cambiar la foto' })
        return
      }
      if (!req.file) {
        res.status(400).json({ error: 'Falta el archivo (campo "image")' })
        return
      }

      const { imageUrl } = await saveOwnRecipeImage(recipeId, req.file.buffer)
      res.json({ imageUrl })
    } catch (err) {
      if (err instanceof UnreadableImageError) {
        res.status(415).json({ error: err.message })
        return
      }
      console.error('upload-image error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

// GET /user/:id/recipes — user's own recipes + favorited recipes (cards).
router.get('/user/:id/recipes', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.id)
    if (userId !== req.userId) {
      res.status(403).json({ error: 'No tienes acceso a las recetas de otro usuario.' })
      return
    }

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
      .where(scopeWhere(
        userFavorites.userId,
        userFavorites.householdId,
        await resolveScope(userId),
      ))) as RecipeRow[]

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
  requireRecipeId('recipeId'),
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

      // Toggle is keyed by (user, recipe) regardless of scope — every
      // member toggles their own row. The `householdId` dual-write lets
      // household-scoped reads find any member's favorites.
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
        const householdId = await getPrimaryHouseholdId(userId)
        await db.insert(userFavorites).values({ userId, householdId, recipeId })
        res.json({ favorited: true })
      }
    } catch (err) {
      console.error('Toggle favorite error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

export default router
