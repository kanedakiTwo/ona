/**
 * Scope resolver — picks between legacy `user_id` and household-aware
 * `household_id` filtering for menus, shopping lists, and favorites.
 *
 * Gated by `SHARED_HOUSEHOLD_SCOPE`. When the flag is OFF the world looks
 * exactly like pre-PR-1B: each user only sees their own rows even if they
 * share a household. When ON, any member of a household sees the same set.
 *
 * Read patterns:
 *   const scope = await resolveScope(userId)
 *   db.select().from(menus).where(scopeWhere(menus, scope))
 *
 * Why the indirection: a single switch lets us flip the read column without
 * touching every route, and the env flag keeps the rollout reversible.
 */

import { eq } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db as defaultDb } from '../db/connection.js'
import { users } from '../db/schema.js'
import { env } from '../config/env.js'

/** Loose DB type so tests can pass a proxy/mock. */
type Db = typeof defaultDb

export type Scope =
  | { kind: 'user'; value: string }
  | { kind: 'household'; value: string }

interface PickScopeInput {
  userId: string
  householdId: string | null
  flagOn: boolean
}

/**
 * Pure decision: given the user, their primary household id, and whether
 * the env flag is on, pick which column we read from.
 */
export function pickScope(input: PickScopeInput): Scope {
  if (input.flagOn && input.householdId) {
    return { kind: 'household', value: input.householdId }
  }
  return { kind: 'user', value: input.userId }
}

/**
 * Live wrapper around `pickScope`: fetches the user's primary household and
 * defers to the env flag. Use this from route handlers. The `db` parameter
 * lets skill tests inject a proxy so we don't touch the real database.
 */
export async function resolveScope(userId: string, db: Db = defaultDb): Promise<Scope> {
  if (!env.SHARED_HOUSEHOLD_SCOPE) {
    return { kind: 'user', value: userId }
  }
  const [row] = await db
    .select({ primaryHouseholdId: users.primaryHouseholdId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return pickScope({
    userId,
    householdId: row?.primaryHouseholdId ?? null,
    flagOn: env.SHARED_HOUSEHOLD_SCOPE,
  })
}

/**
 * Build a Drizzle `WHERE` clause from a Scope + the (table.userIdCol, table.householdIdCol)
 * pair. The caller passes the actual columns so we don't have to import
 * every scoped table here.
 */
export function scopeWhere(
  userIdCol: AnyPgColumn,
  householdIdCol: AnyPgColumn,
  scope: Scope,
) {
  return scope.kind === 'household'
    ? eq(householdIdCol, scope.value)
    : eq(userIdCol, scope.value)
}

/**
 * Always-resolve the user's primary household id (independent of the flag).
 * Used by the dual-write path so new inserts populate `household_id` even
 * when reads are still legacy. Returns null when no household exists yet —
 * callers must handle that branch (don't crash; just skip the dual-write).
 */
export async function getPrimaryHouseholdId(
  userId: string,
  db: Db = defaultDb,
): Promise<string | null> {
  const [row] = await db
    .select({ primaryHouseholdId: users.primaryHouseholdId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row?.primaryHouseholdId ?? null
}
