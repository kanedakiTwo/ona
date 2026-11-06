/**
 * The 14-day trial and the Gratis plan (PRO-135, PRO-385, specs/billing.md).
 *
 * From launch day (`LAUNCH_DATE`, 2026-12-15) a household has 14 days (28
 * with a creator's link, PRO-353: `services/creatorTrial.ts`) with
 * everything from when it was created (beta households: from launch day).
 * After that, without a paid plan, it is on **Gratis** (D-158; it was the
 * paused account): it generates and changes its week and its list on the
 * web, but has no Mimo, no autopilot, no alerts and no shop orders. Mimo on
 * WhatsApp answers it once a day with the notice to choose a plan. Nothing
 * is deleted. Before launch day nobody is on Gratis, and this module
 * doesn't even touch the database.
 *
 * The rule is the pure `accountAccess` in `@ona/shared`; here it is fed from
 * the DB (the user's primary household and its latest subscription).
 */
import { desc, eq } from 'drizzle-orm'
import type { NextFunction, Response } from 'express'
import {
  PLAN_GRATIS_MESSAGE,
  PAID_ACCESS_STATUSES,
  accountAccess,
  type AccountAccess,
  trialDaysFor,
  type SubscriptionStatus,
} from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { households, subscriptions, users } from '../db/schema.js'
import type { AuthRequest } from '../middleware/auth.js'
import { isBeta } from './billing.js'
import { creatorRefsSql } from './creatorTrial.js'

export interface AccessFacts {
  householdCreatedAt: Date | null
  latestStatus: SubscriptionStatus | null
  /** `TRIAL_DAYS`, or `CREATOR_TRIAL_DAYS` when its creator came with a creator's link (PRO-353). */
  trialDays?: number
}

/** The user's primary household's creation, its trial length and its latest subscription's status. */
export async function loadAccessFacts(userId: string, db: typeof defaultDb = defaultDb): Promise<AccessFacts | null> {
  const [u] = await db
    .select({
      householdId: users.primaryHouseholdId,
      userCreatedAt: users.createdAt,
      householdCreatedAt: households.createdAt,
      creatorRefs: creatorRefsSql('households'),
    })
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
  return { householdCreatedAt: u.householdCreatedAt ?? u.userCreatedAt ?? null, latestStatus, trialDays: trialDaysFor(u.creatorRefs) }
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
    trialDays: facts?.trialDays,
  })
}

/**
 * True when the household is on Gratis (never before launch day). A failed
 * read never takes anything away from anyone.
 */
export async function isOnFreePlan(
  userId: string,
  now: Date = new Date(),
  load: (userId: string) => Promise<AccessFacts | null> = loadAccessFacts,
): Promise<boolean> {
  if (isBeta(now)) return false
  try {
    return (await accessForUser(userId, now, load)).state === 'gratis'
  } catch (err) {
    console.error('[access] check failed (not limiting):', err)
    return false
  }
}

/**
 * Put after authMiddleware on what Gratis doesn't include (PRO-385, D-158):
 * Mimo (chat, advisor, voice) and shop orders. 402 `PLAN_GRATIS`. Admins are
 * exempt. Generating and changing the week is never behind it.
 */
export function requirePaidPlan(
  opts: { gratis?: (userId: string, now: Date) => Promise<boolean>; now?: () => Date; message?: string } = {},
) {
  const gratis = opts.gratis ?? ((id, now) => isOnFreePlan(id, now))
  const now = opts.now ?? (() => new Date())
  const message = opts.message ?? PLAN_GRATIS_MESSAGE
  return async function paidPlanGuard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    const userId = req.userId
    if (!userId || req.user?.role === 'admin') return next()
    if (await gratis(userId, now())) {
      res.status(402).json({ error: message, code: 'PLAN_GRATIS' })
      return
    }
    next()
  }
}
