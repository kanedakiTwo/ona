/**
 * The household's «¿Qué tal?» answers in the automatic menu (PRO-111,
 * specs/menus.md): a recipe rated 5 («Repetir a menudo») weighs like a
 * favourite; one rated 1 («Mejor no») never comes out on its own — it can
 * still be picked by hand. 2–4 change nothing.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { recipeNotes } from '../db/schema.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'

type Db = typeof defaultDb

export const BOOST_RATING = 5
export const EXCLUDE_RATING = 1

/** Pure: ratings → recipes to boost and recipes to leave out of automatic picks. */
export function householdRatingSets(rows: ReadonlyArray<{ recipeId: string; rating: number | null }>): {
  boost: Set<string>
  exclude: Set<string>
} {
  const boost = new Set<string>()
  const exclude = new Set<string>()
  for (const r of rows) {
    if (r.rating === BOOST_RATING) boost.add(r.recipeId)
    else if (r.rating === EXCLUDE_RATING) exclude.add(r.recipeId)
  }
  return { boost, exclude }
}

export async function loadHouseholdRatingSets(userId: string, db: Db = defaultDb) {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return { boost: new Set<string>(), exclude: new Set<string>() }
  const rows = await db
    .select({ recipeId: recipeNotes.recipeId, rating: recipeNotes.rating })
    .from(recipeNotes)
    .where(and(eq(recipeNotes.householdId, householdId), inArray(recipeNotes.rating, [BOOST_RATING, EXCLUDE_RATING])))
  return householdRatingSets(rows)
}

/**
 * Pure: the matcher inputs with the ratings applied — favourites plus the
 * 5-star recipes, and the week's vetoes plus the 1-star ones. New sets: the
 * week's own `bannedRecipeIds` (what «Vetadas esta semana» lists) is untouched.
 */
export function withHouseholdRatings(
  favorites: ReadonlySet<string>,
  banned: ReadonlySet<string> | undefined,
  rated: { boost: ReadonlySet<string>; exclude: ReadonlySet<string> },
): { favoriteRecipeIds: Set<string>; bannedRecipeIds: Set<string> } {
  return {
    favoriteRecipeIds: new Set([...favorites, ...rated.boost]),
    bannedRecipeIds: new Set([...(banned ?? []), ...rated.exclude]),
  }
}
