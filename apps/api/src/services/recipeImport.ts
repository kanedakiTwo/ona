import type { Difficulty, ExtractedRecipe } from '@ona/shared'
import { persistRecipe, type RecipeWriteInput } from './recipePersistence.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { extractRecipeFromImage } from './recipeExtractor.js'
import { extractRecipeFromUrl } from './recipeUrlExtractor.js'

/**
 * One persist path for every "import a recipe" entry point: the
 * `POST /recipes/extract-from-url` route, the assistant's
 * `import_recipe_from_url` skill, and WhatsApp photos. Imports go through
 * soft lint (findings come back as warnings) — the user reviews and edits
 * on the recipe page afterwards.
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
