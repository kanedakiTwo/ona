/**
 * PRO-1200 · El primer menú, solo con recetas «de diario» (specs/menus.md).
 *
 * A household is **starting** during its first 2 weeks with a menu, or while
 * it has fewer than 5 signals (favourites, «Me apetece» / «Me encanta» and
 * 4-5 stars). While starting, every automatic pick (the weekly generator and
 * every «Cambiar» through `menuSlotPick.ts`) draws only from the recipes
 * tagged `diario` that pass the usual filters; a slot none fits takes the
 * whole catalogue (never an empty slot). Afterwards, at most 2 dishes a week
 * from outside `diario` («para descubrir»), drawn with the usual weights.
 * What the household chose (favourites, ratings, «Me apetece») never counts
 * as outside. With no `diario` recipe in the catalogue, nothing changes.
 */
import { and, eq, inArray, ne } from 'drizzle-orm'
import { isEverydayRecipe } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { menus, recipeNotes, recipeVerdicts, userFavorites } from '../db/schema.js'
import { getPrimaryHouseholdId, resolveScope, scopeWhere } from './scopeResolver.js'
import { householdMemberIds } from './tasteStore.js'

type Db = typeof defaultDb

/** Weeks with a menu (other than this one) a household needs to stop starting. */
export const START_WEEKS = 2
/** Signals (favourites, «Me apetece», 4-5 stars) a household needs to stop starting. */
export const START_SIGNALS = 5
/** Dishes a week from outside `diario` once the household is past starting. */
export const DISCOVERIES_PER_WEEK = 2

export interface EverydayPolicy {
  /** The `diario` recipes plus what the household chose (never «outside»). */
  ids: ReadonlySet<string>
  /** How many dishes of the week may come from outside: 0 while starting. */
  discoveries: number
}

/** Pure: starting = fewer than 2 other weeks with a menu, or fewer than 5 signals. */
export function isStarting(otherWeeks: number, signals: number): boolean {
  return otherWeeks < START_WEEKS || signals < START_SIGNALS
}

/**
 * Pure: the week's policy, or null when the catalogue has no `diario`
 * recipe yet (everything as before PRO-1200).
 */
export function everydayPolicy(
  recipes: ReadonlyArray<{ id: string; tags?: readonly string[] | null; internalTags?: readonly string[] | null }>,
  starting: boolean,
  chosen: Iterable<string> = [],
): EverydayPolicy | null {
  const everyday = recipes.filter((r) => isEverydayRecipe(r)).map((r) => r.id)
  if (everyday.length === 0) return null
  return { ids: new Set([...everyday, ...chosen]), discoveries: starting ? 0 : DISCOVERIES_PER_WEEK }
}

/** Pure: whether a dish of this recipe counts as one from outside `diario`. */
export function isDiscovery(policy: EverydayPolicy | null | undefined, recipeId: string): boolean {
  return !!policy && !policy.ids.has(recipeId)
}

/**
 * Pure: the pools to try for one dish, in order. With no discoveries left,
 * each pool reduced to `diario` first, then the pools as they were (so a slot
 * none fits still gets a dish).
 */
export function everydayTries<T extends { id: string }>(pools: T[][], policy: EverydayPolicy | null | undefined, discoveriesLeft: number): T[][] {
  if (!policy || discoveriesLeft > 0) return pools
  return [...pools.map((p) => p.filter((r) => policy.ids.has(r.id))), ...pools]
}

/**
 * Pure: for one slot change (`menuSlotPick.ts`), the set the matcher keeps to
 * when it can (`MatcherOptions.everyday`), or undefined to draw as usual.
 * `weekRecipeIds`: the recipes of the rest of the week.
 */
export function slotEveryday(policy: EverydayPolicy | null | undefined, weekRecipeIds: Iterable<string>): ReadonlySet<string> | undefined {
  if (!policy) return undefined
  let outside = 0
  for (const id of weekRecipeIds) if (!policy.ids.has(id)) outside++
  return outside >= policy.discoveries ? policy.ids : undefined
}

/**
 * Whether the household is starting for this week: its other weeks with a
 * menu and its signals (favourites, «Me apetece» / «Me encanta» of any member,
 * 4-5 stars), each recipe counted once. A read error counts as starting.
 */
export async function loadIsStarting(userId: string, weekStart: string, db: Db = defaultDb): Promise<boolean> {
  try {
    const scope = await resolveScope(userId, db)
    const weeks = await db
      .selectDistinct({ weekStart: menus.weekStart })
      .from(menus)
      .where(and(scopeWhere(menus.userId, menus.householdId, scope), ne(menus.weekStart, weekStart)))
      .limit(START_WEEKS)
    const signals = new Set<string>()
    const favs = await db
      .select({ recipeId: userFavorites.recipeId })
      .from(userFavorites)
      .where(scopeWhere(userFavorites.userId, userFavorites.householdId, scope))
    for (const f of favs) signals.add(f.recipeId)
    const householdId = await getPrimaryHouseholdId(userId, db)
    if (householdId) {
      const rated = await db
        .select({ recipeId: recipeNotes.recipeId })
        .from(recipeNotes)
        .where(and(eq(recipeNotes.householdId, householdId), inArray(recipeNotes.rating, [4, 5])))
      for (const r of rated) signals.add(r.recipeId)
    }
    const verdicts = await db
      .select({ recipeId: recipeVerdicts.recipeId })
      .from(recipeVerdicts)
      .where(and(inArray(recipeVerdicts.userId, await householdMemberIds(userId, db)), inArray(recipeVerdicts.verdict, ['love', 'like'])))
    for (const v of verdicts) signals.add(v.recipeId)
    return isStarting(weeks.length, signals.size)
  } catch {
    return true
  }
}
