/**
 * Mimo offers to invite another household after a resolved week (PRO-164,
 * D-059; specs/advisor.md «Invitar tras una semana resuelta»).
 *
 * The same in the web chat and on WhatsApp (D-051): once the household has
 * its first resolved week — a menu for that week AND the shopping list used
 * (checked / in stock / added) that week or the weekend before, the
 * definition of `/admin/metrics` — Mimo adds ONE line at the end of its next
 * reply with the account's «Invitar a otro hogar» link. Only ever in a reply
 * to the user (`chat()`), so on WhatsApp it is always inside the 24-hour
 * window: never a message of its own, never a template.
 *
 *   - Once: `users.invite_offer_at` is stamped atomically when it goes out.
 *   - A «no» to it (the next message) switches it off for good
 *     (`users.invite_offer_declined_at`).
 *   - Not in the same week as the /menu WhatsApp card (PRO-107): while that
 *     card is still to be shown, the card goes first; the week it is shown,
 *     the offer waits for a later resolved week.
 *
 * Pure rules (tests/inviteOffer.test.ts) + the DB glue (`maybeAppendInviteOffer`).
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { users } from '../db/schema.js'
import { addDays, madridParts, madridWeekStart } from './madridTime.js'
import { shoppingWeeksFor } from './businessMetrics.js'
import { accountReferralUrl, ensureReferralCode } from './accountReferrals.js'
import { isUserAllowed, isWhatsAppConfigured } from './whatsapp/config.js'
import { loadNudgeState } from './whatsapp/nudge.js'
import type { ChatMessage } from './assistant/types.js'

type Db = typeof defaultDb

/** Miguel's text (2026-10-18). The link goes at the end. */
export function inviteOfferLine(link: string): string {
  return `Esta semana ya la tienes resuelta. ¿Conoces a alguien que siempre está con el "¿qué cenamos?"? Te dejo tu enlace para invitarle: ${link}`
}

/** What the previous reply must contain for a «no» to count as the answer to it. */
export const INVITE_OFFER_MARKER = 'Te dejo tu enlace para invitarle'

/** Pure: the resolved weeks (Mondays) from the menus' weeks and the days the list was used. */
export function resolvedWeeks(menuWeeks: readonly string[], shoppingDays: readonly string[]): string[] {
  const shopped = new Set(shoppingDays.flatMap((d) => shoppingWeeksFor(d)))
  return [...new Set(menuWeeks)].filter((w) => shopped.has(w)).sort()
}

export interface InviteOfferInput {
  offeredAt: Date | null
  declinedAt: Date | null
  /** Mondays (YYYY-MM-DD, Madrid) of the household's resolved weeks. */
  resolvedWeeks: readonly string[]
  /** When the PRO-107 WhatsApp card was shown on /menu. */
  whatsappNudgeAt: Date | null
  /** The PRO-107 card is still to be shown (WhatsApp available, not linked, not shown yet). */
  whatsappNudgePending: boolean
  now: Date
}

/** Pure: append the offer to this reply? */
export function shouldOfferInvite(i: InviteOfferInput): boolean {
  if (i.offeredAt || i.declinedAt) return false
  if (i.whatsappNudgePending) return false
  const week = madridWeekStart(i.now)
  if (i.whatsappNudgeAt && madridWeekStart(i.whatsappNudgeAt) === week) return false
  // A resolved week the user is in: this one, or the coming one already
  // resolved at the weekend (menu for Monday + the weekend shop).
  if (i.resolvedWeeks.includes(week)) return true
  return madridParts(i.now).weekday >= 5 && i.resolvedWeeks.includes(addDays(week, 7))
}

/** The whole message is a «no» (not «No, cámbiame el jueves», which is about something else). */
const NEGATIVE = /^(no|nop|nope|nah|paso|ahora no|mejor no|no conozco a nadie|no me interesa|no quiero)(,? gracias)?$/i

/** Pure: is this message a «no» to the offer Mimo just made? */
export function isInviteOfferDeclined(message: string, history: readonly ChatMessage[]): boolean {
  const last = [...history].reverse().find((m) => m.role === 'assistant')
  if (!last || !last.content.includes(INVITE_OFFER_MARKER)) return false
  const text = message.trim().replace(/^[¡¿]+/, '').replace(/[.!?]+$/g, '').trim()
  return NEGATIVE.test(text)
}

/** Pure: the reply with the offer at the end. */
export function withInviteOffer(message: string, link: string): string {
  const body = message.trimEnd()
  return body ? `${body}\n\n${inviteOfferLine(link)}` : inviteOfferLine(link)
}

// ─── DB glue ─────────────────────────────────────────────────────

async function loadState(userId: string, db: Db) {
  const res = await db.execute(sql`
    SELECT u.invite_offer_at AS offered_at, u.invite_offer_declined_at AS declined_at, u.email,
           u.primary_household_id AS household_id,
           EXISTS (SELECT 1 FROM whatsapp_links wl WHERE wl.user_id = u.id) AS linked
      FROM users u WHERE u.id = ${userId}::uuid
  `)
  return (res.rows as any[])[0] ?? null
}

async function loadResolvedWeeks(userId: string, householdId: string | null, db: Db): Promise<string[]> {
  const scope = householdId
    ? sql`COALESCE(x.household_id, u.primary_household_id) = ${householdId}::uuid`
    : sql`x.user_id = ${userId}::uuid`
  const menus = await db.execute(sql`
    SELECT DISTINCT to_char(x.week_start, 'YYYY-MM-DD') AS week
      FROM menus x JOIN users u ON u.id = x.user_id WHERE ${scope}
  `)
  const shopping = await db.execute(sql`
    SELECT DISTINCT to_char(x.created_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS day
      FROM activity_events x JOIN users u ON u.id = x.user_id
      WHERE x.kind LIKE 'shopping_%' AND ${scope}
  `)
  return resolvedWeeks(
    (menus.rows as any[]).map((r) => String(r.week)),
    (shopping.rows as any[]).map((r) => String(r.day)),
  )
}

/** The rule's input from the database (null for an unknown user). Throws on a DB error. */
export async function loadInviteOfferInput(userId: string, db: Db = defaultDb, now: Date = new Date()): Promise<InviteOfferInput | null> {
  const s = await loadState(userId, db)
  if (!s) return null
  const offeredAt = s.offered_at ? new Date(s.offered_at) : null
  const declinedAt = s.declined_at ? new Date(s.declined_at) : null
  if (offeredAt || declinedAt) {
    return { offeredAt, declinedAt, resolvedWeeks: [], whatsappNudgeAt: null, whatsappNudgePending: false, now }
  }
  const available = isWhatsAppConfigured() && isUserAllowed(s.email ?? null)
  const nudgeAt = available && !s.linked ? (await loadNudgeState(userId)).nudgeAt : null
  return {
    offeredAt,
    declinedAt,
    resolvedWeeks: await loadResolvedWeeks(userId, s.household_id ?? null, db),
    whatsappNudgeAt: nudgeAt,
    whatsappNudgePending: available && !s.linked && nudgeAt == null,
    now,
  }
}

/** A «no» right after the offer: off for good. Never throws. */
export async function recordInviteOfferAnswer(
  userId: string,
  message: string,
  history: readonly ChatMessage[],
  db: Db = defaultDb,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    if (!isInviteOfferDeclined(message, history)) return false
    await db
      .update(users)
      .set({ inviteOfferDeclinedAt: now })
      .where(and(eq(users.id, userId), isNull(users.inviteOfferDeclinedAt)))
    return true
  } catch (err) {
    console.warn('[invite-offer] answer not recorded:', (err as Error)?.message ?? err)
    return false
  }
}

/**
 * The reply, with the offer at the end when it is due (and stamped so it
 * never repeats). Never throws: on any failure the reply goes as it was.
 */
export async function maybeAppendInviteOffer(
  userId: string,
  reply: string,
  db: Db = defaultDb,
  now: Date = new Date(),
): Promise<string> {
  try {
    const input = await loadInviteOfferInput(userId, db, now)
    if (!input || !shouldOfferInvite(input)) return reply
    const link = accountReferralUrl(await ensureReferralCode(userId, db))
    // Stamp, atomically: two replies at once never both carry it.
    const claimed = await db
      .update(users)
      .set({ inviteOfferAt: now })
      .where(and(eq(users.id, userId), isNull(users.inviteOfferAt), isNull(users.inviteOfferDeclinedAt)))
      .returning({ id: users.id })
    if (claimed.length === 0) return reply
    return withInviteOffer(reply, link)
  } catch (err) {
    console.warn('[invite-offer] skipped:', (err as Error)?.message ?? err)
    return reply
  }
}
