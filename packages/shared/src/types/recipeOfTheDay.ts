/**
 * «La receta del día» (PRO-1099, specs/recipe-of-the-day.md): one published
 * catalogue recipe per day, with what a social post needs — title, a short
 * text, the photo in the two sizes the networks take, key ingredients,
 * minutes, cuisine, credit and the link to the recipe.
 */

/** `AAAA-MM-DD`, the shape of `recipes.featured_on` and of `/recipe-of-the-day/:date`. */
export const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Pure: true for a real calendar day written `AAAA-MM-DD` (no 2026-02-30). */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DAY_RE.test(value)) return false
  const d = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** The two photo sizes: Instagram/Facebook feed (4:5) and link previews / X (1.91:1). */
export const RECIPE_OF_THE_DAY_PHOTO_SIZES = {
  vertical: { width: 1080, height: 1350 },
  horizontal: { width: 1200, height: 630 },
} as const
export type RecipeOfTheDayPhotoFormat = keyof typeof RECIPE_OF_THE_DAY_PHOTO_SIZES

/** The public page of the recipe of the day (and of a given day: `/receta-del-dia/<fecha>`). */
export const RECIPE_OF_THE_DAY_PATH = '/receta-del-dia'

/** What `GET /recipe-of-the-day[/:date]` answers. */
export interface RecipeOfTheDayView {
  /** The day it is the recipe of the day (may be before the one asked for: «hoy no hay»). */
  date: string
  /** The day asked for (today in Madrid when none). */
  requestedDate: string
  /** False when the day asked for has none and this is the last one before it. */
  isRequestedDate: boolean
  recipeId: string
  title: string
  /** A sentence or two for the post, built from the recipe (never source text). */
  text: string
  /** The recipe's own photo (relative or absolute, as `imageUrl` everywhere), or null. */
  imageUrl: string | null
  /** Absolute links to the photo cut to each size (served by the API), or null without a photo. */
  photos: Record<RecipeOfTheDayPhotoFormat, string> | null
  /** Up to five ingredient names, the ones that make the dish (no salt, water or oil). */
  keyIngredients: string[]
  /** Total minutes (else prep), or null. */
  minutes: number | null
  /** «española», «italiana»… or null. */
  cuisine: string | null
  /** The credit line of the ficha (D-067), or null. */
  credit: string | null
  /** The original's link (creator's post or video), or null. */
  sourceUrl: string | null
  /** Absolute link to the recipe on the web. */
  url: string
}
