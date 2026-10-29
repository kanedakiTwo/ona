/**
 * «Este mes» on `/recipes` (PRO-375, specs/recipes.md): the products of the
 * month from the calendar in `@ona/shared` that published catalogue recipes
 * use, and the ingredient filter of `GET /recipes?ingredient=<nombre>`.
 *
 * Matching is by name (normalised, whole word, plurals too) against
 * `ingredients.name`, never by id: «Setas» takes champiñón and boletus,
 * «Calabaza» never takes calabacín.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  findProduce,
  ingredientMatchesProduce,
  produceInSeason,
  RETIRED_RECIPE_TAG,
  SEASONAL_PRODUCE_MIN_RECIPES,
  type SeasonalProduceCount,
} from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes } from '../db/schema.js'
import { PUBLISHED } from './recipeVisibility.js'

/** Month (1–12) in Madrid: CI and the server run in UTC. */
export function madridMonth(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Madrid', month: 'numeric' }).format(now))
}

/**
 * Pure: the month's products used by at least `min` recipes, most used
 * first (calendar order on ties). `rows` are (recipe, ingredient name) pairs.
 */
export function countSeasonalProduce(
  rows: ReadonlyArray<{ recipeId: string; ingredientName: string }>,
  month: number,
  min: number = SEASONAL_PRODUCE_MIN_RECIPES,
): SeasonalProduceCount[] {
  const out: SeasonalProduceCount[] = []
  for (const product of produceInSeason(month)) {
    const ids = new Set<string>()
    for (const r of rows) if (ingredientMatchesProduce(r.ingredientName, product)) ids.add(r.recipeId)
    if (ids.size >= min) out.push({ name: product.name, emoji: product.emoji, recipeCount: ids.size })
  }
  return out.map((p, i) => ({ p, i })).sort((a, b) => b.p.recipeCount - a.p.recipeCount || a.i - b.i).map(({ p }) => p)
}

/** `GET /recipes/seasonal-produce`: over the published, listed catalogue (system recipes). */
export async function loadSeasonalProduce(month: number, db: any = defaultDb): Promise<SeasonalProduceCount[]> {
  const rows = await db
    .select({ recipeId: recipeIngredients.recipeId, ingredientName: ingredients.name })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id))
    .where(
      and(
        eq(recipes.status, PUBLISHED),
        isNull(recipes.authorId),
        sql`NOT (${RETIRED_RECIPE_TAG} = ANY(coalesce(${recipes.internalTags}, ARRAY[]::text[])))`,
      ),
    )
  return countSeasonalProduce(rows, month)
}

/** Ids of the catalogue ingredients a name stands for (the calendar product, or the name itself). */
export async function ingredientIdsNamed(name: string, db: any = defaultDb): Promise<string[]> {
  const product = findProduce(name) ?? name
  const rows: Array<{ id: string; name: string }> = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(inArray(ingredients.id, db.selectDistinct({ id: recipeIngredients.ingredientId }).from(recipeIngredients)))
  return rows.filter((r) => ingredientMatchesProduce(r.name, product)).map((r) => r.id)
}
