import { and, asc, eq, isNull } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { recipes, type CatalogSourceInfo } from '../db/schema.js'
import { PUBLISHED } from './recipeVisibility.js'

/**
 * PRO-1077 (specs/recipes.md → «SEO de la ficha»): which catalogue recipes a
 * search engine may index. Every published Mimoia recipe goes to
 * `sitemap.xml` **except the ones from a book** (D-104: credited with the
 * book's «…» or recorded with `catalog_source.book`) until Legal says they
 * can be indexed; their page carries `noindex` too (`fromBook` on
 * GET /recipes/:id).
 */

type Db = typeof defaultDb

/** Pure: a recipe adapted from a book — a `book` in its source, or a credit quoting one («…»). */
export function isBookRecipe(source: Pick<CatalogSourceInfo, 'book' | 'credit'> | null | undefined): boolean {
  if (!source || typeof source !== 'object') return false
  if (typeof source.book === 'string' && source.book.trim()) return true
  return typeof source.credit === 'string' && /«[^»]+»/.test(source.credit)
}

export interface SitemapRecipe {
  id: string
  updatedAt: string | null
}

/** Pure: the rows that go to the sitemap, in the order given. */
export function sitemapRecipes(
  rows: ReadonlyArray<{ id: string; updatedAt: Date | null; catalogSource: CatalogSourceInfo | null }>,
): SitemapRecipe[] {
  return rows
    .filter((r) => !isBookRecipe(r.catalogSource))
    .map((r) => ({ id: r.id, updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null }))
}

/** Published catalogue recipes (`authorId IS NULL`), oldest first, without the book ones. */
export async function loadSitemapRecipes(db: Db = defaultDb): Promise<SitemapRecipe[]> {
  const rows = await db
    .select({ id: recipes.id, updatedAt: recipes.updatedAt, catalogSource: recipes.catalogSource })
    .from(recipes)
    .where(and(eq(recipes.status, PUBLISHED), isNull(recipes.authorId)))
    .orderBy(asc(recipes.createdAt), asc(recipes.id))
  return sitemapRecipes(rows)
}
