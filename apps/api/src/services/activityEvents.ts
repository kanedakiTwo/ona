/**
 * Append-only product-activity signals for GET /admin/metrics (see
 * specs/metrics.md). Only for actions no other table timestamps durably —
 * today, shopping-list use: the `shopping_lists` row is rewritten on every
 * read (including the WhatsApp shopping reminder's), so its `created_at`
 * can't say when a household actually shopped.
 *
 * Captured without touching the shopping routes: an app-level middleware
 * watches the item-mutation routes finish with 2xx, and the assistant/voice
 * tool runners report the two skills that write the list directly.
 *
 * Fire-and-forget like the cost ledger: never blocks or fails the request.
 */
import type { NextFunction, Request, Response } from 'express'
import { sql } from 'drizzle-orm'
import { db } from '../db/connection.js'

export type ActivityKind = 'shopping_check' | 'shopping_stock' | 'shopping_add'

const SHOPPING_ROUTES: Array<{ method: string; re: RegExp; kind: ActivityKind }> = [
  { method: 'PUT', re: /^\/shopping-list\/[^/]+\/item\/[^/]+\/check\/?$/, kind: 'shopping_check' },
  { method: 'PUT', re: /^\/shopping-list\/[^/]+\/item\/[^/]+\/stock\/?$/, kind: 'shopping_stock' },
  { method: 'POST', re: /^\/shopping-list\/[^/]+\/items\/?$/, kind: 'shopping_add' },
]

/** Pure: the activity a shopping-list request represents, or null. Reads never count. */
export function shoppingActivityKind(method: string, path: string): ActivityKind | null {
  return SHOPPING_ROUTES.find((r) => r.method === method && r.re.test(path))?.kind ?? null
}

/** Pure: skills that write the shopping list directly (not through the HTTP routes above). */
export function skillActivityKind(skillName: string): ActivityKind | null {
  if (skillName === 'check_shopping_item') return 'shopping_check'
  if (skillName === 'mark_in_stock') return 'shopping_stock'
  return null
}

export function recordActivity(userId: string, kind: ActivityKind): void {
  // Unit tests run without a migrated DB; never write to the developer's DB from vitest.
  if (process.env.VITEST) return
  db.execute(sql`
    INSERT INTO activity_events (user_id, household_id, kind)
    VALUES (${userId}::uuid, (SELECT primary_household_id FROM users WHERE id = ${userId}::uuid), ${kind})
  `).catch((err: any) => console.warn('[activity] record failed (ignored):', err?.message ?? err))
}

/**
 * Assistant / voice tool runners call this after a skill ran. Skills report
 * "not found" as a result with `data: null` instead of throwing — those don't count.
 */
export function recordSkillActivity(skillName: string, userId: string, result: { data?: unknown }): void {
  const kind = skillActivityKind(skillName)
  if (kind && result?.data != null) recordActivity(userId, kind)
}

/**
 * App-level middleware (index.ts, before the routers): once a shopping-list
 * item mutation finishes with 2xx, log it for the authed user that
 * `authMiddleware` attached further down the chain.
 */
export function trackShoppingActivity(req: Request, res: Response, next: NextFunction): void {
  const kind = shoppingActivityKind(req.method, req.path)
  if (kind) {
    res.on('finish', () => {
      const userId = (req as Request & { userId?: string }).userId
      if (userId && res.statusCode >= 200 && res.statusCode < 300) recordActivity(userId, kind)
    })
  }
  next()
}
