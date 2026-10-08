import type { Difficulty, ExtractedRecipe, Meal, Season } from '@ona/shared'
import { persistRecipe, type RecipeWriteInput } from './recipePersistence.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { extractRecipeFromImage, matchIngredients } from './recipeExtractor.js'
import { extractRecipeFromUrl } from './recipeUrlExtractor.js'
import { scheduleHouseImage } from './recipeHouseImage.js'

/**
 * One persist path for every "import a recipe" entry point: the
 * `POST /recipes/extract-from-url` route, the assistant's
 * `import_recipe_from_url` skill, and WhatsApp photos. Imports go through
 * soft lint (findings come back as warnings) — the user reviews and edits
 * on the recipe page afterwards — and get a house-style photo in the
 * background (recipeHouseImage.ts).
 */

/** Pure: extractor output → the write shape `persistRecipe` takes. */
export function extractedToWriteInput(
  extracted: ExtractedRecipe,
  opts: { internalTags: string[]; sourceUrl?: string | null },
): RecipeWriteInput {
  const ingredients = extracted.ingredients
    .filter((i) => i.matched && i.ingredientId)
    .map((i, idx) => ({
      ingredientId: i.ingredientId as string,
      quantity: i.quantity,
      unit: i.unit,
      displayOrder: idx,
    }))
  return {
    name: extracted.name,
    // Cover photo captured by the URL extractor (JSON-LD image, og:image or
    // YouTube thumbnail); null for photo imports.
    imageUrl: extracted.imageUrl ?? null,
    servings: extracted.servings,
    prepTime: extracted.prepTime ?? null,
    cookTime: extracted.cookTime ?? null,
    difficulty: (extracted.difficulty ?? 'medium') as Difficulty,
    meals: extracted.meals,
    seasons: extracted.seasons,
    tags: extracted.tags ?? [],
    internalTags: opts.internalTags,
    sourceUrl: extracted.sourceUrl ?? opts.sourceUrl ?? null,
    sourceType: extracted.sourceType ?? null,
    ingredients,
    steps: extracted.steps.map((text, index) => ({ index, text })),
  }
}

export type SaveExtractedResult =
  | { ok: true; recipeId: string; warnings: string[] }
  | { ok: false; errors: unknown[]; warnings: unknown[] }

export async function saveExtractedRecipe(
  extracted: ExtractedRecipe,
  opts: { authorId: string | null; internalTags: string[]; sourceUrl?: string | null },
): Promise<SaveExtractedResult> {
  const result = await persistRecipe(
    extractedToWriteInput(extracted, { internalTags: opts.internalTags, sourceUrl: opts.sourceUrl }),
    { authorId: opts.authorId, softLint: true, force: true },
  )
  if (!result.ok) return { ok: false, errors: result.errors, warnings: result.warnings }
  // The source's og:image / thumbnail is a stand-in until the house photo
  // (this dish, our style, checked) replaces it in the background.
  scheduleHouseImage(result.recipeId, opts.authorId)
  return {
    ok: true,
    recipeId: result.recipeId,
    warnings: [...result.warnings.map((w) => w.message), ...extracted.warnings],
  }
}

export interface ImportedRecipe {
  recipeId: string
  name: string
  warnings: string[]
}

async function saveOrThrow(
  extracted: ExtractedRecipe,
  userId: string,
  internalTags: string[],
  sourceUrl?: string,
): Promise<ImportedRecipe> {
  const saved = await saveExtractedRecipe(extracted, { authorId: userId, internalTags, sourceUrl })
  if (!saved.ok) throw new Error('La receta extraída no ha pasado la validación')
  return { recipeId: saved.recipeId, name: extracted.name, warnings: saved.warnings }
}

/** YouTube video or recipe article → saved user recipe. Throws NotARecipeError for non-recipes. */
export async function importRecipeFromUrl(url: string, userId: string): Promise<ImportedRecipe> {
  const extracted = await extractRecipeFromUrl(url, { provider: new AnthropicProvider() })
  return saveOrThrow(extracted, userId, ['auto-extracted', 'from-url'], url)
}

/** Photo of a recipe (cookbook page, handwritten card…) → saved user recipe. */
export async function importRecipeFromImage(
  image: Buffer,
  mimeType: string,
  userId: string,
): Promise<ImportedRecipe> {
  const extracted = await extractRecipeFromImage(new AnthropicProvider(), image, mimeType)
  return saveOrThrow(extracted, userId, ['auto-extracted', 'from-photo'])
}

// ─── Recipes the assistant writes from a conversation ────────────

export interface RecipeParts {
  name: string
  servings?: number | null
  prepTime?: number | null
  cookTime?: number | null
  meals?: string[]
  seasons?: string[]
  steps: string[]
  ingredients: Array<{ name: string; quantity?: number | null; unit?: string | null }>
}

const MEALS_OK: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']
const SEASONS_OK: Season[] = ['spring', 'summer', 'autumn', 'winter']

/** Pure: sane defaults so a chat-described recipe always persists. */
export function normalizeRecipeParts(parts: RecipeParts) {
  const meals = (parts.meals ?? []).filter((m): m is Meal => MEALS_OK.includes(m as Meal))
  const seasons = (parts.seasons ?? []).filter((x): x is Season => SEASONS_OK.includes(x as Season))
  const servings = Number.isInteger(parts.servings) && (parts.servings as number) > 0 ? Math.min(parts.servings as number, 12) : null
  return {
    meals: meals.length ? meals : (['lunch', 'dinner'] as Meal[]),
    seasons: seasons.length ? seasons : SEASONS_OK,
    servings: servings ?? 2,
    servingsConfidence: (servings ? 'explicit' : 'estimated') as 'explicit' | 'estimated',
    steps: (parts.steps ?? []).map((x) => String(x).trim()).filter(Boolean),
    ingredients: (parts.ingredients ?? [])
      .filter((i) => i?.name)
      .map((i) => ({ name: i.name, quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 1, unit: i.unit || 'u' })),
  }
}

/**
 * "Créalo tú": a recipe described in chat → saved user recipe, through the
 * same ingredient matching (with USDA auto-create) and soft-lint persist as
 * URL/photo imports. Replaces the assistant's old raw INSERT, which skipped
 * servings (NOT NULL → failed in prod) and left ingredients unlinked.
 */
export async function createRecipeFromParts(parts: RecipeParts, userId: string): Promise<ImportedRecipe> {
  const n = normalizeRecipeParts(parts)
  const { matched, warnings } = await matchIngredients(n.ingredients, { recipeName: parts.name })
  const unmatched = matched.filter((i) => !i.matched).length
  const extracted: ExtractedRecipe = {
    name: parts.name,
    imageUrl: null,
    servings: n.servings,
    servingsConfidence: n.servingsConfidence,
    prepTime: parts.prepTime ?? null,
    cookTime: parts.cookTime ?? null,
    meals: n.meals,
    seasons: n.seasons,
    difficulty: null,
    tags: [],
    steps: n.steps,
    ingredients: matched,
    unmatchedCount: unmatched,
    warnings: unmatched > 0 ? [...warnings, `${unmatched} ingrediente(s) no encontrado(s) en la base de datos`] : warnings,
  }
  return saveOrThrow(extracted, userId, ['assistant-created'])
}
