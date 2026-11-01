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
  meals?: readonly string[] | null
  /** 'starter' | 'main' | 'dessert'; null = versatile. */
  course?: string | null
  /** Public tags (internal ones never reach the card). */
  tags?: readonly string[] | null
  allergens?: readonly string[] | null
  /** The importer wasn't sure of the allergens (internal tag `alergenos:duda`, PRO-376). */
  allergenDoubt?: boolean | null
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
 * Minutes shown on a card and used by the time filters: the total time
 * (server-derived) when known, else the prep time. `null` when unknown or 0.
 */
export function recipeMinutes(recipe: Pick<CatalogRecipeLike, 'prepTime' | 'totalTime'>): number | null {
  if (recipe.totalTime != null && recipe.totalTime > 0) return recipe.totalTime
  if (recipe.prepTime != null && recipe.prepTime > 0) return recipe.prepTime
  return null
}

/**
 * Intent shortcuts of the chip row (PRO-376, from FuturApp). «Listas en 15
 * min» is not one: it is the 15-minute time filter (`maxTime`).
 *   - quickDinner «Cenas rápidas»: dinner and at most 30 min;
 *   - nibbles «Para picar»: a starter, or tagged `picoteo`;
 *   - glutenFree «Sin gluten»: no `gluten` allergen and no allergen doubt.
 */
export const CATALOG_INTENTS = ['quickDinner', 'nibbles', 'glutenFree'] as const
export type CatalogIntent = (typeof CATALOG_INTENTS)[number]

/** «Cenas rápidas»: dinner within this many minutes. */
export const QUICK_DINNER_MAX_TIME = 30

export function isQuickDinner(recipe: CatalogRecipeLike): boolean {
  const minutes = recipeMinutes(recipe)
  return (recipe.meals ?? []).includes('dinner') && minutes != null && minutes <= QUICK_DINNER_MAX_TIME
}

export function isNibbles(recipe: CatalogRecipeLike): boolean {
  return recipe.course === 'starter' || (recipe.tags ?? []).some((t) => t.toLowerCase() === 'picoteo')
}

export function isGlutenFree(recipe: CatalogRecipeLike): boolean {
  return !recipe.allergenDoubt && !(recipe.allergens ?? []).includes('gluten')
}

const INTENT_MATCHERS: Record<CatalogIntent, (r: CatalogRecipeLike) => boolean> = {
  quickDinner: isQuickDinner,
  nibbles: isNibbles,
  glutenFree: isGlutenFree,
}

export function matchesCatalogIntent(recipe: CatalogRecipeLike, intent: CatalogIntent): boolean {
  return INTENT_MATCHERS[intent](recipe)
}

export interface CatalogFilterState {
  scope: CatalogScope
  userId?: string | null
  /** Recipes that fit this season (all-year ones included). */
  season?: Season | '' | null
  /** Max total minutes; recipes with unknown time are dropped. */
  maxTime?: number | '' | null
  /** Intent chips that are on; a recipe must match all of them. */
  intents?: readonly CatalogIntent[]
}

/** Client-side part of the catalogue filters (meal, search and custom tags are server-side). */
export function filterCatalogRecipes<T extends CatalogRecipeLike>(
  recipes: readonly T[],
  { scope, userId, season, maxTime, intents = [] }: CatalogFilterState,
): T[] {
  return recipes.filter((r) => {
    if (scope === 'mine' && (!userId || r.authorId !== userId)) return false
    if (scope === 'ona' && !isCuratedRecipe(r)) return false
    if (season && !isInSeason((r.seasons ?? []) as Season[], season)) return false
    if (maxTime) {
      const minutes = recipeMinutes(r)
      if (minutes == null || minutes > maxTime) return false
    }
    return intents.every((i) => matchesCatalogIntent(r, i))
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
