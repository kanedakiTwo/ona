import { SEASONS, type Season } from '../constants/enums.js'
import { detectSeason, isInSeason } from './seasons.js'

/**
 * Catalogue (`/recipes`) helpers — pure, shared so the rule is unit-tested
 * from `apps/api/src/tests/catalogSeason.test.ts`.
 *
 * Season rule: "now" is `detectSeason(date)` — meteorological seasons for
 * Spain (Dec–Feb invierno, Mar–May primavera, Jun–Aug verano, Sep–Nov otoño),
 * month read in the caller's local time. It is the same rule the menu
 * generator uses, so "de temporada" means the same thing everywhere.
 *
 * A season is never derived from the ORDER of `recipe.seasons` (the old cards
 * showed `seasons[0]`, i.e. "Primavera" all year for all-year recipes).
 */

export type CatalogScope = 'all' | 'mine' | 'ona'

/** Minimal card shape the helpers need (the `GET /recipes` card satisfies it). */
export interface CatalogRecipeLike {
  id: string
  authorId?: string | null
  imageUrl?: string | null
  seasons?: readonly string[] | null
  prepTime?: number | null
  totalTime?: number | null
}

/** "Selección Mimoia": system / curated recipes (`authorId IS NULL`). */
export function isCuratedRecipe(recipe: Pick<CatalogRecipeLike, 'authorId'>): boolean {
  return recipe.authorId == null
}

/** Empty `seasons` means all year, same as listing the four seasons. */
export function isAllYearRecipe(seasons: readonly string[] | null | undefined): boolean {
  if (!seasons || seasons.length === 0) return true
  return SEASONS.every((s) => seasons.includes(s))
}

/**
 * The season label a card may show: the CURRENT season, and only for a
 * recipe that is genuinely seasonal and in season now. All-year and
 * out-of-season recipes get `null` (show nothing).
 */
export function recipeSeasonBadge(
  seasons: readonly string[] | null | undefined,
  date: Date = new Date(),
): Season | null {
  if (isAllYearRecipe(seasons)) return null
  const now = detectSeason(date)
  return seasons!.includes(now) ? now : null
}

/**
 * Minutes shown on a card and used by the time filters: the total time
 * (server-derived) when known, else the prep time. `null` when unknown or 0.
 */
export function recipeMinutes(recipe: Pick<CatalogRecipeLike, 'prepTime' | 'totalTime'>): number | null {
  if (recipe.totalTime != null && recipe.totalTime > 0) return recipe.totalTime
  if (recipe.prepTime != null && recipe.prepTime > 0) return recipe.prepTime
  return null
}

export interface CatalogFilterState {
  scope: CatalogScope
  userId?: string | null
  /** Recipes that fit this season (all-year ones included). */
  season?: Season | '' | null
  /** Max total minutes; recipes with unknown time are dropped. */
  maxTime?: number | '' | null
}

/** Client-side part of the catalogue filters (meal, search and custom tags are server-side). */
export function filterCatalogRecipes<T extends CatalogRecipeLike>(
  recipes: readonly T[],
  { scope, userId, season, maxTime }: CatalogFilterState,
): T[] {
  return recipes.filter((r) => {
    if (scope === 'mine' && (!userId || r.authorId !== userId)) return false
    if (scope === 'ona' && !isCuratedRecipe(r)) return false
    if (season && !isInSeason((r.seasons ?? []) as Season[], season)) return false
    if (maxTime) {
      const minutes = recipeMinutes(r)
      if (minutes == null || minutes > maxTime) return false
    }
    return true
  })
}

function dayIndex(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  )
}

function rotate<T>(list: T[], offset: number): T[] {
  if (list.length === 0) return list
  const k = ((offset % list.length) + list.length) % list.length
  return [...list.slice(k), ...list.slice(0, k)]
}

/**
 * Pick the "De temporada" hero recipe(s): in season now and with a photo.
 * Preference: curated seasonal recipes → curated all-year → any in season.
 * Rotates once a day (stable within the day).
 */
export function pickFeaturedRecipes<T extends CatalogRecipeLike>(
  recipes: readonly T[],
  { date = new Date(), count = 1 }: { date?: Date; count?: number } = {},
): T[] {
  const now = detectSeason(date)
  const withPhoto = recipes.filter(
    (r) => !!r.imageUrl && isInSeason((r.seasons ?? []) as Season[], now),
  )
  const tiers = [
    withPhoto.filter((r) => isCuratedRecipe(r) && !isAllYearRecipe(r.seasons)),
    withPhoto.filter((r) => isCuratedRecipe(r) && isAllYearRecipe(r.seasons)),
    withPhoto.filter((r) => !isCuratedRecipe(r)),
  ]
  const day = dayIndex(date)
  const picked: T[] = []
  for (const tier of tiers) {
    for (const r of rotate(tier, day)) {
      if (picked.length >= count) return picked
      picked.push(r)
    }
  }
  return picked
}
