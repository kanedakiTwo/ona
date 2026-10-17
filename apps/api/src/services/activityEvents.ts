/**
 * Append-only product-activity signals for GET /admin/metrics (see
 * specs/metrics.md). Only for actions no other table timestamps durably —
 * today, shopping-list use: the `shopping_lists` row is rewritten on every
 * read (including the WhatsApp shopping reminder's), so its `created_at`
 * can't say when a household actually shopped.
 *
 * Captured by an app-level middleware that watches the item-mutation routes
 * finish with 2xx, and the assistant/voice tool runners report the two skills
 * that write the list directly. Since 0063 each row can also say which
 * product (`item`) and, for toggles, its new state (`toggled_on`): the routes
 * leave it in `res.locals.activity` (`setActivityDetail`), the skills in their
 * result. It is a signal for the household's ficha (PRO-151).
 *
 * Fire-and-forget like the cost ledger: never blocks or fails the request.
 */
import type { NextFunction, Request, Response } from 'express'
import { sql } from 'drizzle-orm'
import { db } from '../db/connection.js'

export type ActivityKind = 'shopping_check' | 'shopping_stock' | 'shopping_add' | 'shopping_remove'

/** What the row says about the product touched (PRO-151). */
export interface ActivityDetail {
  item?: string | null
  /** check / stock toggles: the new state. */
  on?: boolean | null
}

export const ACTIVITY_ITEM_MAX = 80

const SHOPPING_ROUTES: Array<{ method: string; re: RegExp; kind: ActivityKind }> = [
  { method: 'PUT', re: /^\/shopping-list\/[^/]+\/item\/[^/]+\/check\/?$/, kind: 'shopping_check' },
  { method: 'PUT', re: /^\/shopping-list\/[^/]+\/item\/[^/]+\/stock\/?$/, kind: 'shopping_stock' },
  { method: 'POST', re: /^\/shopping-list\/[^/]+\/items\/?$/, kind: 'shopping_add' },
  { method: 'DELETE', re: /^\/shopping-list\/[^/]+\/item\/[^/]+\/?$/, kind: 'shopping_remove' },
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

/** Pure: the detail as stored — a trimmed product name (≤ 80 chars) and a boolean or null. */
export function normalizeActivityDetail(detail: ActivityDetail | null | undefined): { item: string | null; on: boolean | null } {
  const raw = typeof detail?.item === 'string' ? detail.item.replace(/\s+/g, ' ').trim() : ''
  return {
    item: raw ? raw.slice(0, ACTIVITY_ITEM_MAX) : null,
    on: typeof detail?.on === 'boolean' ? detail.on : null,
  }
}

/** Routes call this before answering so the middleware stores which product it was. */
export function setActivityDetail(res: Response, detail: ActivityDetail): void {
  res.locals.activity = detail
}

export function recordActivity(userId: string, kind: ActivityKind, detail?: ActivityDetail | null): void {
  // Unit tests run without a migrated DB; never write to the developer's DB from vitest.
  if (process.env.VITEST) return
  const { item, on } = normalizeActivityDetail(detail)
  db.execute(sql`
    INSERT INTO activity_events (user_id, household_id, kind, item, toggled_on)
    VALUES (${userId}::uuid, (SELECT primary_household_id FROM users WHERE id = ${userId}::uuid), ${kind}, ${item}, ${on})
  `).catch((err: any) => console.warn('[activity] record failed (ignored):', err?.message ?? err))
}

/**
 * Assistant / voice tool runners call this after a skill ran. Skills report
 * "not found" as a result with `data: null` instead of throwing — those don't count.
 */
export function recordSkillActivity(skillName: string, userId: string, result: { data?: unknown }): void {
  const kind = skillActivityKind(skillName)
  if (kind && result?.data != null) recordActivity(userId, kind, skillActivityDetail(result.data))
}

/** Pure: `check_shopping_item` → `{ name, checked }`, `mark_in_stock` → `{ name, inStock }`. */
export function skillActivityDetail(data: unknown): ActivityDetail | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { name?: unknown; checked?: unknown; inStock?: unknown }
  const on = typeof d.checked === 'boolean' ? d.checked : typeof d.inStock === 'boolean' ? d.inStock : null
  return { item: typeof d.name === 'string' ? d.name : null, on }
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
      if (userId && res.statusCode >= 200 && res.statusCode < 300) recordActivity(userId, kind, res.locals?.activity)
    })
  }
  next()
}
