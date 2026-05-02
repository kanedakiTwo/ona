/**
 * URL-based recipe extractor — entry point for `POST /recipes/extract-from-url`.
 *
 * Detects whether the URL is a YouTube video or a generic article and delegates
 * to the matching source module. Reuses the same `matchIngredients` (with USDA
 * auto-create) used by the photo extractor so unmatched ingredients don't fail
 * lint downstream.
 */

import type { ExtractedRecipe, Meal, Season, Difficulty } from '@ona/shared'
import {
  matchIngredients,
  type RawExtractedRecipe,
  type TextExtractionProvider,
} from './recipeExtractor.js'
import { detectSourceType, type UrlSourceType } from './sources/sourceType.js'
import {
  extractArticleRecipe,
  type ArticleFetcher,
} from './sources/article.js'
import {
  extractYouTubeRecipe,
  type YouTubeFetchers,
} from './sources/youtube.js'

export { detectSourceType } from './sources/sourceType.js'
export type { UrlSourceType } from './sources/sourceType.js'

const VALID_MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']
const VALID_SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
const VALID_DIFFICULTIES = new Set<string>(['easy', 'medium', 'hard'])

/**
 * Thrown when the source extractor (or the LLM) decides the URL doesn't
 * describe an actual recipe. Carries the reason for UI display.
 */
export class NotARecipeError extends Error {
  reason: string
  constructor(reason: string) {
    super(reason)
    this.name = 'NotARecipeError'
    this.reason = reason
  }
}

export interface ExtractFromUrlDeps {
  provider: TextExtractionProvider
  /** Fetcher injected for testability. Defaults to `globalThis.fetch`. */
  fetchArticle?: ArticleFetcher
  /** YouTube fetchers injected for testability. */
  youtube?: YouTubeFetchers
}

/**
 * Top-level entry point. Returns the same `ExtractedRecipe` shape produced
 * by the photo extractor plus `sourceUrl` + `sourceType` so the route handler
 * can persist them in one go via `persistRecipe`.
 */
export async function extractRecipeFromUrl(
  url: string,
  deps: ExtractFromUrlDeps,
): Promise<ExtractedRecipe> {
  const sourceType = detectSourceType(url)

  let raw: RawExtractedRecipe
  if (sourceType === 'youtube') {
    const result = await extractYouTubeRecipe(url, {
      provider: deps.provider,
      fetchers: deps.youtube,
    })
    if (!result.isRecipe) throw new NotARecipeError(result.reason)
    raw = result.raw
  } else {
    const result = await extractArticleRecipe(url, {
      provider: deps.provider,
      fetchArticle: deps.fetchArticle,
    })
    if (!result.isRecipe) throw new NotARecipeError(result.reason)
    raw = result.raw
  }

  const { matched: matchedIngredients, warnings: matchWarnings } =
    await matchIngredients(raw.ingredients)

  const meals = (raw.suggestedMeals ?? []).filter((m): m is Meal =>
    VALID_MEALS.includes(m as Meal),
  )
  const seasons = (raw.suggestedSeasons ?? []).filter((s): s is Season =>
    VALID_SEASONS.includes(s as Season),
  )

  const unmatchedCount = matchedIngredients.filter((i) => !i.matched).length
  const warnings: string[] = [...matchWarnings]
  if (unmatchedCount > 0) {
    warnings.push(`${unmatchedCount} ingrediente(s) no encontrado(s) en la base de datos`)
  }

  const difficulty: Difficulty | null =
    raw.difficulty && VALID_DIFFICULTIES.has(raw.difficulty.toLowerCase())
      ? (raw.difficulty.toLowerCase() as Difficulty)
      : null

  return {
    name: raw.name,
    servings: raw.servings ?? null,
    prepTime: raw.prepTime,
    cookTime: raw.cookTime ?? null,
    meals: meals.length > 0 ? meals : ['lunch', 'dinner'],
    seasons: seasons.length > 0 ? seasons : [...VALID_SEASONS],
    difficulty,
    tags: raw.tags ?? [],
    steps: raw.steps,
    ingredients: matchedIngredients,
    unmatchedCount,
    warnings,
    sourceUrl: url,
    sourceType,
  }
}
