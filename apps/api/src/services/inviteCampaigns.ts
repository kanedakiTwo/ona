/**
 * Invitation links by campaign + the closed-beta gate on `POST /register`
 * (PRO-27). `mimoia.com/i/<code>` → `/register?campana=<code>`. During the
 * beta (`REGISTRATION_MODE=invite`) an account can only be created with:
 *   1. a valid campaign link (not expired, uses left);
 *   2. an email that is on the waitlist with status `invited`;
 *   3. a household invitation (`/invites/:token`), which must never break;
 *   4. an admin email (`ADMIN_EMAILS`).
 * Anyone else gets 403 `REGISTRATION_INVITE_REQUIRED`.
 */
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { householdInvites, inviteCampaigns, waitlistEntries } from '../db/schema.js'
import { generateReferralCode } from './waitlist.js'

type Db = typeof defaultDb

export const REGISTRATION_INVITE_REQUIRED = {
  code: 'REGISTRATION_INVITE_REQUIRED',
  error: 'Mimoia está en beta cerrada: de momento solo se puede entrar con invitación. Apúntate a la lista de espera y te avisamos.',
} as const

export interface GateInput {
  mode: 'invite' | 'open'
  isAdminEmail: boolean
  campaignOk: boolean
  waitlistInvited: boolean
  householdInviteOk: boolean
}

/** Pure decision: which way in (or null = rejected). */
export function registrationAccess(i: GateInput): 'open' | 'admin' | 'campaign' | 'waitlist' | 'household' | null {
  if (i.mode === 'open') return 'open'
  if (i.isAdminEmail) return 'admin'
  if (i.campaignOk) return 'campaign'
  if (i.waitlistInvited) return 'waitlist'
  if (i.householdInviteOk) return 'household'
  return null
}

/** Usable campaign (exists, not expired, uses left) or null. Doesn't consume a use. */
export async function findUsableCampaign(code: string | undefined, now = new Date(), db: Db = defaultDb) {
  if (!code) return null
  const [row] = await db
    .select({ id: inviteCampaigns.id, name: inviteCampaigns.name })
    .from(inviteCampaigns)
    .where(
      and(
        eq(inviteCampaigns.code, code),
        or(isNull(inviteCampaigns.expiresAt), gt(inviteCampaigns.expiresAt, now)),
        or(isNull(inviteCampaigns.maxUses), lt(inviteCampaigns.uses, inviteCampaigns.maxUses)),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Atomically take one use; false when it ran out (or expired) meanwhile. */
export async function consumeCampaignUse(id: string, now = new Date(), db: Db = defaultDb): Promise<boolean> {
  const rows = await db
    .update(inviteCampaigns)
    .set({ uses: sql`${inviteCampaigns.uses} + 1` })
    .where(
      and(
        eq(inviteCampaigns.id, id),
        or(isNull(inviteCampaigns.expiresAt), gt(inviteCampaigns.expiresAt, now)),
        or(isNull(inviteCampaigns.maxUses), lt(inviteCampaigns.uses, inviteCampaigns.maxUses)),
      ),
    )
    .returning({ id: inviteCampaigns.id })
  return rows.length > 0
}

export async function isWaitlistInvited(email: string, db: Db = defaultDb): Promise<boolean> {
  const [row] = await db
    .select({ id: waitlistEntries.id })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.email, email.trim().toLowerCase()), eq(waitlistEntries.status, 'invited')))
    .limit(1)
  return !!row
}

export async function isHouseholdInviteUsable(token: string | undefined, now = new Date(), db: Db = defaultDb): Promise<boolean> {
  if (!token) return false
  const [row] = await db
    .select({ id: householdInvites.id })
    .from(householdInvites)
    .where(and(eq(householdInvites.token, token), isNull(householdInvites.consumedAt), gt(householdInvites.expiresAt, now)))
    .limit(1)
  return !!row
}

// ─── Admin ───────────────────────────────────────────────────────

export interface NewCampaign {
  name: string
  maxUses: number | null
  expiresAt: Date | null
}

export async function createCampaign(input: NewCampaign, adminId: string, db: Db = defaultDb) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await db
      .insert(inviteCampaigns)
      .values({ ...input, code: generateReferralCode(), createdBy: adminId })
      .onConflictDoNothing()
      .returning()
    if (rows[0]) return rows[0]
  }
  throw new Error('invite campaigns: could not allocate a unique code')
}

export async function listCampaigns(db: Db = defaultDb) {
  return db
    .select({
      id: inviteCampaigns.id,
      name: inviteCampaigns.name,
      code: inviteCampaigns.code,
      maxUses: inviteCampaigns.maxUses,
      uses: inviteCampaigns.uses,
      expiresAt: inviteCampaigns.expiresAt,
      createdAt: inviteCampaigns.createdAt,
    })
    .from(inviteCampaigns)
    .orderBy(desc(inviteCampaigns.createdAt))
}

export function campaignUrl(publicUrl: string, code: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/i/${code}`
}
