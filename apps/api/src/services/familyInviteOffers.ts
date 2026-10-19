/**
 * «Familia en el mismo hogar» offers (D-088; specs/household.md → «Ofrecer
 * la invitación»). The invitation to bring the couple or the family into
 * this household is offered in three moments, once each and never again:
 *
 *   - `alta`: in the sign-up, when the person says there are 2 adults or
 *     more (PRO-261);
 *   - `compra`: the first time the shopping list opens (PRO-261);
 *   - `mimo`: Mimo, after the first resolved week (PRO-262).
 *
 * Never to a household that already has 2 people (accounts), nor to a
 * member who isn't the owner (only the owner can invite). Each moment is
 * stamped in `users.family_invite_offers` the first time it is shown.
 *
 * Pure rules (tests/familyInviteOffers.test.ts) + the DB glue.
 */
import { eq, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { households, householdMembers, users } from '../db/schema.js'

type Db = typeof defaultDb

export const FAMILY_OFFER_MOMENTS = ['alta', 'compra', 'mimo'] as const
export type FamilyOfferMoment = (typeof FAMILY_OFFER_MOMENTS)[number]

/** ISO dates: when each moment was shown, and a «no» to Mimo's offer. */
export interface FamilyOfferState {
  alta?: string
  compra?: string
  mimo?: string
  mimoDeclined?: string
}

const STATE_KEYS = ['alta', 'compra', 'mimo', 'mimoDeclined'] as const

export function parseFamilyOfferState(raw: unknown): FamilyOfferState {
  if (!raw || typeof raw !== 'object') return {}
  const out: FamilyOfferState = {}
  for (const k of STATE_KEYS) {
    const v = (raw as Record<string, unknown>)[k]
    if (typeof v === 'string') out[k] = v
  }
  return out
}

export interface FamilyOfferInput {
  state: FamilyOfferState
  /** Accounts in the household. */
  members: number
  /** Only the owner can create invitations. */
  isOwner: boolean
  /** Adults the household cooks for (`users.adults`, or what the sign-up form says right now). */
  adults: number
}

/** Pure: the household could still get the invitation at all. */
export function familyOfferEligible(i: Omit<FamilyOfferInput, 'adults'>): boolean {
  return i.members < 2 && i.isOwner && !i.state.mimoDeclined
}

/** Pure: show the offer at this moment (sign-up or list)? */
export function familyOfferDue(moment: 'alta' | 'compra', i: FamilyOfferInput): boolean {
  if (i.state[moment]) return false
  if (i.adults < 2) return false
  return familyOfferEligible(i)
}

// ─── DB glue ─────────────────────────────────────────────────────

/** The offer's input from the database (null for a user without a household). */
export async function loadFamilyOfferInput(userId: string, db: Db = defaultDb): Promise<FamilyOfferInput | null> {
  const [u] = await db
    .select({ offers: users.familyInviteOffers, adults: users.adults, householdId: users.primaryHouseholdId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!u?.householdId) return null
  const [h] = await db.select({ ownerId: households.ownerId }).from(households).where(eq(households.id, u.householdId)).limit(1)
  const [m] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, u.householdId))
  return {
    state: parseFamilyOfferState(u.offers),
    members: Number(m?.n ?? 0),
    isOwner: h?.ownerId === userId,
    adults: u.adults ?? 0,
  }
}

/**
 * Stamp a moment as shown (or Mimo's «no»), only the first time: atomic, so
 * two tabs never both get it. True when this call stamped it.
 */
export async function stampFamilyOffer(
  userId: string,
  key: FamilyOfferMoment | 'mimoDeclined',
  db: Db = defaultDb,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ familyInviteOffers: sql`${users.familyInviteOffers} || jsonb_build_object(${key}::text, ${now.toISOString()}::text)` })
    .where(sql`${users.id} = ${userId}::uuid AND NOT (${users.familyInviteOffers} ? ${key}::text)`)
    .returning({ id: users.id })
  return rows.length > 0
}
