/**
 * «La receta del día» (PRO-1099, specs/recipe-of-the-day.md): the published
 * catalogue recipe whose `featured_on` is the day asked for — or, when that
 * day has none («hoy no hay»), the last one before it, with its own date.
 * What a social post needs, built from the recipe itself (no AI, never the
 * source's text): title, a short text, key ingredients, minutes, cuisine,
 * credit, the original's link, the link to the recipe and the photo cut to
 * 1080×1350 and 1200×630 (cut here, `recipeOfTheDayPhoto`; the web serves it
 * on its own domain at `/receta-del-dia/<fecha>/foto/<formato>`).
 *
 * Only `published` recipes with no author: Miguel sees every recipe of the
 * day before it goes out (D-164.1), so a draft never shows here.
 */
import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm'
import sharp from 'sharp'
import {
  RECIPE_OF_THE_DAY_PATH,
  RECIPE_OF_THE_DAY_PHOTO_SIZES,
  recipeTotalMinutes,
  type RecipeOfTheDayPhotoFormat,
  type RecipeOfTheDayView,
} from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes, type CatalogSourceInfo } from '../db/schema.js'
import { catalogSourceCredit } from './catalogImport.js'
import { madridParts } from './madridTime.js'
import { PUBLISHED } from './recipeVisibility.js'
import { absolutePhotoUrl } from './weekImage/photos.js'

type Db = typeof defaultDb

export interface FeaturedRecipeRow {
  id: string
  name: string
  featuredOn: string
  imageUrl: string | null
  prepTime: number | null
  cookTime: number | null
  totalTime: number | null
  tags: string[] | null
  internalTags: string[] | null
  sourceUrl: string | null
  catalogSource: CatalogSourceInfo | null
}

export interface FeaturedIngredientRow {
  name: string
  unit: string
  optional: boolean
  displayOrder: number
}

export interface RecipeOfTheDayDeps {
  /** The published catalogue recipe of `day`, or of the last day before it with one. */
  findFeatured: (day: string) => Promise<FeaturedRecipeRow | null>
  ingredientsOf: (recipeId: string) => Promise<FeaturedIngredientRow[]>
  webUrl: string
}

/** Today in Madrid (AAAA-MM-DD): the day the recipe of the day changes. */
export function todayInMadrid(now: Date = new Date()): string {
  return madridParts(now).isoDate
}

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').replace(/\s+/g, ' ').trim()
}

/** What every dish has and no post would name. */
const MINOR_INGREDIENT_RE = /^(sal|agua|aceite|pimienta|hielo)\b/
export const KEY_INGREDIENTS_MAX = 5

/** Pure: up to five ingredients that make the dish, in the recipe's order (no salt, water, oil, «al gusto» or optional). */
export function keyIngredients(rows: readonly FeaturedIngredientRow[], max = KEY_INGREDIENTS_MAX): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of [...rows].sort((a, b) => a.displayOrder - b.displayOrder)) {
    if (r.optional || r.unit === 'pizca' || r.unit === 'al_gusto') continue
    const name = r.name.trim()
    const key = fold(name)
    if (!key || MINOR_INGREDIENT_RE.test(key) || seen.has(key)) continue
    seen.add(key)
    out.push(name.charAt(0).toLowerCase() + name.slice(1))
    if (out.length >= max) break
  }
  return out
}

/**
 * Pure: the cuisine as the ficha reads it. The import keeps it twice: the
 * hidden `cocina:<slug>` and the readable public tag («española»); the
 * public tag whose slug matches wins, else the slug with its hyphens as spaces.
 */
export function cuisineOf(row: Pick<FeaturedRecipeRow, 'tags' | 'internalTags'>): string | null {
  const tag = (row.internalTags ?? []).find((t) => t.toLowerCase().startsWith('cocina:'))
  if (!tag) return null
  const slug = tag.slice('cocina:'.length).trim().toLowerCase()
  if (!slug) return null
  const slugOf = (s: string) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const readable = (row.tags ?? []).find((t) => slugOf(t) === slug)
  return readable ? readable.trim().toLowerCase() : slug.replace(/-/g, ' ')
}

function listEs(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/** Pure: the post's short text, from the recipe's own data («Lentejas estofadas, de la cocina española, en 45 minutos. Con lentejas, chorizo y zanahoria.»). */
export function shortText(input: { title: string; minutes: number | null; cuisine: string | null; keyIngredients: readonly string[] }): string {
  const parts = [input.title.trim()]
  if (input.cuisine) parts.push(`de la cocina ${input.cuisine}`)
  if (input.minutes) parts.push(`en ${input.minutes} minutos`)
  const first = `${parts.join(', ')}.`
  return input.keyIngredients.length ? `${first} Con ${listEs(input.keyIngredients)}.` : first
}

/** Pure: absolute link to the photo cut to `format`, served by the web. */
export function photoUrl(webUrl: string, date: string, format: RecipeOfTheDayPhotoFormat): string {
  return `${webUrl.replace(/\/+$/, '')}${RECIPE_OF_THE_DAY_PATH}/${date}/foto/${format}`
}

/** Pure: the view from the recipe and its ingredients. */
export function buildRecipeOfTheDayView(
  row: FeaturedRecipeRow,
  ings: readonly FeaturedIngredientRow[],
  opts: { requestedDate: string; webUrl: string },
): RecipeOfTheDayView {
  const webUrl = opts.webUrl.replace(/\/+$/, '')
  const minutes = recipeTotalMinutes(row)
  const cuisine = cuisineOf(row)
  const key = keyIngredients(ings)
  return {
    date: row.featuredOn,
    requestedDate: opts.requestedDate,
    isRequestedDate: row.featuredOn === opts.requestedDate,
    recipeId: row.id,
    title: row.name.trim(),
    text: shortText({ title: row.name, minutes, cuisine, keyIngredients: key }),
    imageUrl: row.imageUrl ?? null,
    photos: row.imageUrl
      ? { vertical: photoUrl(webUrl, row.featuredOn, 'vertical'), horizontal: photoUrl(webUrl, row.featuredOn, 'horizontal') }
      : null,
    keyIngredients: key,
    minutes,
    cuisine,
    credit: catalogSourceCredit(row.catalogSource),
    sourceUrl: row.sourceUrl ?? null,
    url: `${webUrl}/recipes/${row.id}`,
  }
}

/** The recipe of the day for `day` (today in Madrid by default), or null when there has never been one up to it. */
export async function loadRecipeOfTheDay(day: string, deps: RecipeOfTheDayDeps): Promise<RecipeOfTheDayView | null> {
  const row = await deps.findFeatured(day)
  if (!row) return null
  return buildRecipeOfTheDayView(row, await deps.ingredientsOf(row.id), { requestedDate: day, webUrl: deps.webUrl })
}

// ─── The photo, cut to each size ────────────────────────────────

export const PHOTO_SOURCE_MAX_BYTES = 12 * 1024 * 1024
const PHOTO_CACHE_MAX = 12
const photoCache = new Map<string, Buffer>()

/** Pure-ish: the photo cut to `format` (cover, centred on what matters), as JPEG. */
export async function cutPhoto(source: Buffer, format: RecipeOfTheDayPhotoFormat): Promise<Buffer> {
  const { width, height } = RECIPE_OF_THE_DAY_PHOTO_SIZES[format]
  return sharp(source).rotate().resize(width, height, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 85, mozjpeg: true }).toBuffer()
}

export interface RecipeOfTheDayPhotoDeps {
  /** The recipe of exactly that day (no fallback: a post's photo is that day's). */
  photoOf: (day: string) => Promise<{ recipeId: string; imageUrl: string | null } | null>
  fetchImage: (url: string) => Promise<Buffer | null>
  webUrl: string
}

/** The JPEG of `day`'s recipe photo cut to `format`, or null (no recipe that day, no photo, or it can't be read). Kept in memory, a dozen at most. */
export async function recipeOfTheDayPhoto(day: string, format: RecipeOfTheDayPhotoFormat, deps: RecipeOfTheDayPhotoDeps): Promise<Buffer | null> {
  const found = await deps.photoOf(day)
  if (!found?.imageUrl) return null
  const key = `${found.recipeId}|${found.imageUrl}|${format}`
  const cached = photoCache.get(key)
  if (cached) return cached
  const url = absolutePhotoUrl(found.imageUrl, deps.webUrl)
  if (!url) return null
  const source = await deps.fetchImage(url)
  if (!source) return null
  let out: Buffer
  try {
    out = await cutPhoto(source, format)
  } catch {
    return null
  }
  if (photoCache.size >= PHOTO_CACHE_MAX) photoCache.delete(photoCache.keys().next().value as string)
  photoCache.set(key, out)
  return out
}

/** Tests only. */
export function clearRecipeOfTheDayPhotoCache(): void {
  photoCache.clear()
}

async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const len = Number(r.headers.get('content-length') ?? 0)
    if (len > PHOTO_SOURCE_MAX_BYTES) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.length > 0 && buf.length <= PHOTO_SOURCE_MAX_BYTES ? buf : null
  } catch {
    return null
  }
}

export function createDbRecipeOfTheDayPhotoDeps(webUrl: string, db: Db = defaultDb): RecipeOfTheDayPhotoDeps {
  return {
    webUrl,
    fetchImage: fetchImageBytes,
    async photoOf(day) {
      const [row] = await db
        .select({ recipeId: recipes.id, imageUrl: recipes.imageUrl })
        .from(recipes)
        .where(and(eq(recipes.featuredOn, day), eq(recipes.status, PUBLISHED), isNull(recipes.authorId)))
        .limit(1)
      return row ?? null
    },
  }
}

export function createDbRecipeOfTheDayDeps(webUrl: string, db: Db = defaultDb): RecipeOfTheDayDeps {
  return {
    webUrl,
    async findFeatured(day) {
      const [row] = await db
        .select({
          id: recipes.id,
          name: recipes.name,
          featuredOn: recipes.featuredOn,
          imageUrl: recipes.imageUrl,
          prepTime: recipes.prepTime,
          cookTime: recipes.cookTime,
          totalTime: recipes.totalTime,
          tags: recipes.tags,
          internalTags: recipes.internalTags,
          sourceUrl: recipes.sourceUrl,
          catalogSource: recipes.catalogSource,
        })
        .from(recipes)
        .where(and(lte(recipes.featuredOn, day), eq(recipes.status, PUBLISHED), isNull(recipes.authorId)))
        .orderBy(desc(recipes.featuredOn))
        .limit(1)
      return row && row.featuredOn ? ({ ...row, featuredOn: row.featuredOn } as FeaturedRecipeRow) : null
    },
    async ingredientsOf(recipeId) {
      return db
        .select({
          name: ingredients.name,
          unit: recipeIngredients.unit,
          optional: recipeIngredients.optional,
          displayOrder: recipeIngredients.displayOrder,
        })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
        .where(eq(recipeIngredients.recipeId, recipeId))
        .orderBy(asc(recipeIngredients.displayOrder))
    },
  }
}
