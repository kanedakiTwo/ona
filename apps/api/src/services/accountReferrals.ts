/**
 * Personal invitation link for accounts (PRO-162, specs/waitlist.md →
 * «Invitar a otro hogar»). Every account has a code in the waitlist's format
 * (`<web>/?invita=<code>`); someone who came from the list keeps their list
 * code, so what they already shared still counts. On sign-up the code of
 * whoever invited them is stored (`users.invited_by_code`, never an email);
 * an unknown code, inviting yourself or joining the inviter's own household
 * stores nothing.
 */
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { waitlistReferralUrl } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { householdInvites, users, waitlistEntries } from '../db/schema.js'
import { env } from '../config/env.js'
import { generateReferralCode } from './waitlist.js'

type Db = typeof defaultDb

const MAX_ATTEMPTS = 8

export interface InviterInfo {
  /** The account that owns the code, or null when it is a waitlist person's. */
  userId: string | null
  email: string
  householdId: string | null
}

/**
 * Pure: whether a sign-up counts as invited by this inviter. Not when the
 * code is unknown, it is the same person (same email), or they are joining
 * the inviter's own household (that is a member, not another home).
 */
export function invitationCounts(
  inviter: InviterInfo | null,
  signup: { email: string; joiningHouseholdId: string | null },
): boolean {
  if (!inviter) return false
  if (inviter.email.trim().toLowerCase() === signup.email.trim().toLowerCase()) return false
  if (signup.joiningHouseholdId && inviter.householdId && signup.joiningHouseholdId === inviter.householdId) return false
  return true
}

/** Whose code is it: an account's first, else an active waitlist person's. */
export async function findInviterByCode(code: string, db: Db = defaultDb): Promise<InviterInfo | null> {
  const [account] = await db
    .select({ id: users.id, email: users.email, householdId: users.primaryHouseholdId })
    .from(users)
    .where(eq(users.referralCode, code))
    .limit(1)
  if (account) return { userId: account.id, email: account.email, householdId: account.householdId ?? null }
  const [entry] = await db
    .select({ email: waitlistEntries.email })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.referralCode, code), ne(waitlistEntries.status, 'unsubscribed')))
    .limit(1)
  if (!entry?.email) return null
  // A list person who already has an account: their household matters too.
  const [joined] = await db
    .select({ id: users.id, householdId: users.primaryHouseholdId })
    .from(users)
    .where(eq(users.email, entry.email))
    .limit(1)
  return { userId: joined?.id ?? null, email: entry.email, householdId: joined?.householdId ?? null }
}

/** Household a sign-up joins through a household invitation token, if any. */
export async function householdOfInvite(token: string | undefined, db: Db = defaultDb): Promise<string | null> {
  if (!token) return null
  const [row] = await db
    .select({ householdId: householdInvites.householdId })
    .from(householdInvites)
    .where(eq(householdInvites.token, token))
    .limit(1)
  return row?.householdId ?? null
}

/** The code to store for a sign-up, or null (see `invitationCounts`). Never throws. */
export async function inviterCodeForSignup(
  code: string | null | undefined,
  signup: { email: string; householdInviteToken?: string },
  db: Db = defaultDb,
): Promise<string | null> {
  if (!code) return null
  try {
    const inviter = await findInviterByCode(code, db)
    const joiningHouseholdId = await householdOfInvite(signup.householdInviteToken, db)
    return invitationCounts(inviter, { email: signup.email, joiningHouseholdId }) ? code : null
  } catch (err: any) {
    console.warn('[referrals] inviter lookup failed (ignored):', err?.message ?? err)
    return null
  }
}

async function codeInUse(code: string, db: Db): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT 1 FROM users WHERE referral_code = ${code}
    UNION ALL SELECT 1 FROM waitlist_entries WHERE referral_code = ${code}
    LIMIT 1
  `)
  return (res.rows as unknown[]).length > 0
}

/**
 * The account's code, assigned the first time: their waitlist code if they
 * came from the list (and no other account holds it), else a fresh one that
 * no account or list person has.
 */
export async function ensureReferralCode(userId: string, db: Db = defaultDb, newCode: () => string = () => generateReferralCode()): Promise<string> {
  const [me] = await db.select({ code: users.referralCode, email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  if (!me) throw new Error('user not found')
  if (me.code) return me.code

  const [entry] = await db
    .select({ code: waitlistEntries.referralCode })
    .from(waitlistEntries)
    .where(eq(waitlistEntries.email, me.email.trim().toLowerCase()))
    .limit(1)
  const candidates: string[] = []
  if (entry?.code) candidates.push(entry.code)
  for (let i = 0; i < MAX_ATTEMPTS; i++) candidates.push(newCode())

  for (const [i, code] of candidates.entries()) {
    const fromList = i === 0 && code === entry?.code
    if (!fromList && (await codeInUse(code, db))) continue
    try {
      const [row] = await db
        .update(users)
        .set({ referralCode: code })
        .where(and(eq(users.id, userId), isNull(users.referralCode)))
        .returning({ code: users.referralCode })
      if (row?.code) return row.code
      // Someone (a parallel request) set it meanwhile.
      const [again] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1)
      if (again?.code) return again.code
    } catch {
      // Unique clash (another account took it): try the next one.
    }
  }
  throw new Error('could not assign a referral code')
}

export function accountReferralUrl(code: string, origin: string = env.WEB_PUBLIC_URL): string {
  return waitlistReferralUrl(origin, code)
}
