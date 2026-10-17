/**
 * The 14-day trial and the paused account (PRO-135, specs/billing.md).
 *
 * From launch day (`LAUNCH_DATE`, 2026-12-15) a household has 14 days with
 * everything from when it was created (beta households: from launch day).
 * After that, without a paid plan, the account is **paused**: it still sees
 * its menu, recipes and list, but can't generate new menus or use Mimo, and
 * it gets no message from Mimo other than the notice to choose a plan.
 * Nothing is deleted. Before launch day nobody is paused, and this module
 * doesn't even touch the database.
 *
 * The rule is the pure `accountAccess` in `@ona/shared`; here it is fed from
 * the DB (the user's primary household and its latest subscription).
 */
import { desc, eq } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import {
  ACCOUNT_PAUSED_MESSAGE,
  PAID_ACCESS_STATUSES,
  accountAccess,
  type AccountAccess,
  type SubscriptionStatus,
} from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { households, subscriptions, users } from '../db/schema.js'
import type { AuthRequest } from '../middleware/auth.js'
import { isBeta } from './billing.js'

export interface AccessFacts {
  householdCreatedAt: Date | null
  latestStatus: SubscriptionStatus | null
}

/** The user's primary household's creation and its latest subscription's status. */
export async function loadAccessFacts(userId: string, db: typeof defaultDb = defaultDb): Promise<AccessFacts | null> {
  const [u] = await db
    .select({ householdId: users.primaryHouseholdId, userCreatedAt: users.createdAt, householdCreatedAt: households.createdAt })
    .from(users)
    .leftJoin(households, eq(households.id, users.primaryHouseholdId))
    .where(eq(users.id, userId))
    .limit(1)
  if (!u) return null
  let latestStatus: SubscriptionStatus | null = null
  if (u.householdId) {
    const [s] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.householdId, u.householdId))
      .orderBy(desc(subscriptions.updatedAt))
      .limit(1)
    latestStatus = (s?.status as SubscriptionStatus | undefined) ?? null
  }
  return { householdCreatedAt: u.householdCreatedAt ?? u.userCreatedAt ?? null, latestStatus }
}

export async function accessForUser(
  userId: string,
  now: Date = new Date(),
  load: (userId: string) => Promise<AccessFacts | null> = loadAccessFacts,
): Promise<AccountAccess> {
  // Before launch day: the beta, no DB read.
  if (isBeta(now)) return accountAccess({ householdCreatedAt: null, paid: false, now })
  const facts = await load(userId)
  return accountAccess({
    householdCreatedAt: facts?.householdCreatedAt ?? null,
    paid: !!facts?.latestStatus && PAID_ACCESS_STATUSES.includes(facts.latestStatus),
    now,
  })
}

/** True when the account is paused (never before launch day). A failed read never pauses anyone. */
export async function isAccountPaused(
  userId: string,
  now: Date = new Date(),
  load: (userId: string) => Promise<AccessFacts | null> = loadAccessFacts,
): Promise<boolean> {
  if (isBeta(now)) return false
  try {
    return (await accessForUser(userId, now, load)).state === 'paused'
  } catch (err) {
    console.error('[access] check failed (not pausing):', err)
    return false
  }
}

/**
 * Put after authMiddleware on what a paused account can't do: generate a new
 * menu, talk to Mimo. 402 `ACCOUNT_PAUSED`. Admins are exempt. `skip` lets a
 * route keep a harmless variant open (an empty week).
 */
export function requireActiveAccount(
  opts: { paused?: (userId: string, now: Date) => Promise<boolean>; now?: () => Date; skip?: (req: Request) => boolean } = {},
) {
  const paused = opts.paused ?? ((id, now) => isAccountPaused(id, now))
  const now = opts.now ?? (() => new Date())
  return async function activeAccountGuard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    const userId = req.userId
    if (!userId || req.user?.role === 'admin' || opts.skip?.(req)) return next()
    if (await paused(userId, now())) {
      res.status(402).json({ error: ACCOUNT_PAUSED_MESSAGE, code: 'ACCOUNT_PAUSED' })
      return
    }
    next()
  }
}
