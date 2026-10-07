import { eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { householdMembers, recipes } from '../db/schema.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'

/**
 * Who can see a recipe: the ONA catalogue (authorId NULL) is public; a user
 * recipe is visible to its author and to the members of the author's
 * household (they share menus, so a partner's recipe shows up in the shared
 * week). Never to anyone else — specs/recipes.md "Other users' recipes are
 * never returned". Every recipe query that can surface user recipes
 * (catalogue, matcher, assistant, pantry match…) must go through here.
 */

type Db = typeof defaultDb

/** The viewer plus everyone in the viewer's primary household. */
export async function visibleAuthorIds(userId: string, db: Db = defaultDb): Promise<string[]> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return [userId]
  const rows = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
  return Array.from(new Set([userId, ...rows.map((r) => r.userId)]))
}

/** WHERE fragment: catalogue recipes or recipes authored by `authorIds`. */
export function visibleRecipeWhere(authorIds: readonly string[]): SQL {
  return authorIds.length > 0
    ? (or(isNull(recipes.authorId), inArray(recipes.authorId, [...authorIds])) as SQL)
    : (isNull(recipes.authorId) as SQL)
}

/** Convenience for one-off checks (detail pages, copy). */
export async function canViewRecipe(
  viewerId: string | null | undefined,
  authorId: string | null,
  db: Db = defaultDb,
): Promise<boolean> {
  if (authorId === null) return true
  if (!viewerId) return false
  if (authorId === viewerId) return true
  return (await visibleAuthorIds(viewerId, db)).includes(authorId)
}

/** Pure filter for already-loaded rows (matcher candidate lists, tests). */
export function filterVisible<T extends { authorId?: string | null }>(rows: readonly T[], authorIds: readonly string[]): T[] {
  const allowed = new Set(authorIds)
  return rows.filter((r) => r.authorId == null || allowed.has(r.authorId))
}
