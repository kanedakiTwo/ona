import { and, isNull, sql } from 'drizzle-orm'
import type { db } from '../db/connection.js'
import { recipes } from '../db/schema.js'

type Executor = Pick<typeof db, 'select'>

/**
 * The catalogue recipe (system, `author_id IS NULL`) with this name, ignoring
 * case. Catalogue batches (`apply:recipes`) replace a recipe by name, and a
 * user's own recipe that happens to share it must never be overwritten
 * (2026-10-16: a test household's «Pollo empanado» was, in staging).
 */
export async function findCatalogRecipeByName(executor: Executor, name: string) {
  const rows = await executor
    .select({
      id: recipes.id,
      imageUrl: recipes.imageUrl,
      authorId: recipes.authorId,
      createdAt: recipes.createdAt,
    })
    .from(recipes)
    .where(and(sql`LOWER(${recipes.name}) = LOWER(${name})`, isNull(recipes.authorId)))
    .limit(1)
  return rows[0] ?? null
}
