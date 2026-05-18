/**
 * cook_logs business logic — record events + aggregate per-recipe stats.
 *
 * Scope: every read filters by `household_id` when the env flag is on
 * (PR 1B). Writes dual-populate `user_id` + `household_id`. See
 * [household.md](../../../specs/household.md) for the policy.
 */

import { and, desc, eq } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { cookLogs } from '../db/schema.js'
import {
  getPrimaryHouseholdId,
  resolveScope,
  scopeWhere,
} from './scopeResolver.js'

type Db = typeof defaultDb

/** Minimum shape the reducer needs — exported for the test fixture. */
export interface CookLogRow {
  cookedAt: Date
}

export interface CookLogSummary {
  count: number
  lastCookedAt: Date | null
}

/**
 * Pure reducer — turns a list of cook-log rows into `{ count, lastCookedAt }`.
 * Defined as a top-level export so the unit test exercises the same code
 * path the route uses.
 */
export function summarizeCookLog(rows: CookLogRow[]): CookLogSummary {
  if (rows.length === 0) return { count: 0, lastCookedAt: null }
  let latest = rows[0].cookedAt
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].cookedAt > latest) latest = rows[i].cookedAt
  }
  return { count: rows.length, lastCookedAt: latest }
}

export interface RecordCookInput {
  userId: string
  recipeId: string
  menuId?: string | null
  dayIndex?: number | null
  meal?: string | null
  durationMin?: number | null
  notes?: string | null
  /** Defaults to NOW(); explicit value useful for back-fills. */
  cookedAt?: Date
}

/**
 * Append a cook event. Resolves the user's primary household so reads find
 * it under household scope; returns the inserted row id.
 */
export async function recordCook(input: RecordCookInput, db: Db = defaultDb): Promise<string> {
  const householdId = await getPrimaryHouseholdId(input.userId, db)
  const [row] = await db
    .insert(cookLogs)
    .values({
      userId: input.userId,
      householdId,
      recipeId: input.recipeId,
      menuId: input.menuId ?? null,
      dayIndex: input.dayIndex ?? null,
      meal: input.meal ?? null,
      durationMin: input.durationMin ?? null,
      notes: input.notes ?? null,
      cookedAt: input.cookedAt ?? new Date(),
    })
    .returning({ id: cookLogs.id })
  return row.id
}

/**
 * Times-cooked + last-cooked for a specific recipe in the caller's scope.
 * The whole-list pull is fine until a household has thousands of cook
 * events for one recipe (unlikely) — a `count(*)` + `max(cooked_at)` SELECT
 * would be a micro-optimization not worth the complexity yet.
 */
export async function getRecipeCookStats(
  userId: string,
  recipeId: string,
  db: Db = defaultDb,
): Promise<CookLogSummary> {
  const scope = await resolveScope(userId, db)
  const rows = await db
    .select({ cookedAt: cookLogs.cookedAt })
    .from(cookLogs)
    .where(and(
      scopeWhere(cookLogs.userId, cookLogs.householdId, scope),
      eq(cookLogs.recipeId, recipeId),
    ))
  return summarizeCookLog(rows.map((r) => ({ cookedAt: r.cookedAt })))
}

/**
 * Recent cook events for the caller's scope, most-recent first. Used by the
 * analytics page + the "Esto lo cocinamos" history strip on /menu.
 */
export async function listRecentCookLogs(
  userId: string,
  limit: number = 50,
  db: Db = defaultDb,
) {
  const scope = await resolveScope(userId, db)
  return await db
    .select({
      id: cookLogs.id,
      userId: cookLogs.userId,
      recipeId: cookLogs.recipeId,
      menuId: cookLogs.menuId,
      dayIndex: cookLogs.dayIndex,
      meal: cookLogs.meal,
      cookedAt: cookLogs.cookedAt,
      durationMin: cookLogs.durationMin,
      notes: cookLogs.notes,
    })
    .from(cookLogs)
    .where(scopeWhere(cookLogs.userId, cookLogs.householdId, scope))
    .orderBy(desc(cookLogs.cookedAt))
    .limit(limit)
}

/**
 * Hard-delete by id, gated on scope: any household member can delete a
 * cook-log row in the same household when the flag is on; otherwise only
 * the original author.
 */
export async function deleteCookLog(
  userId: string,
  cookLogId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const scope = await resolveScope(userId, db)
  const result = await db
    .delete(cookLogs)
    .where(and(
      eq(cookLogs.id, cookLogId),
      scopeWhere(cookLogs.userId, cookLogs.householdId, scope),
    ))
    .returning({ id: cookLogs.id })
  return result.length > 0
}
