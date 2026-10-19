/**
 * Mimo offers to bring the couple or the family into the household after the
 * first resolved week (PRO-262, D-088; specs/household.md → «Ofrecer la
 * invitación», specs/advisor.md).
 *
 * The same in the web chat and on WhatsApp (D-051): once the household has a
 * resolved week — a menu for that week AND the shopping list used that week
 * or the weekend before (the `/admin/metrics` definition) — Mimo adds ONE
 * line at the end of its next reply. Only in a reply (`chat()`), so on
 * WhatsApp always inside the 24-hour window: never a message of its own or a
 * template. If the person says yes, Mimo prepares the invitation with
 * `invite_to_household` (`source: 'mimo'`).
 *
 *   - Once: `users.family_invite_offers.mimo`, stamped atomically.
 *   - Never to a household with 2 accounts or more, to a member who isn't
 *     the owner, or with 1 adult.
 *   - A «no» as the next message (`mimoDeclined`) switches it off for good
 *     (and the list card too).
 *   - Inside the weekly aviso budget (D-069): `familyOfferBudgetGate` decides
 *     and spends one unit. Until the PRO-215 budget is in this branch it lets
 *     everything through (see the gate below).
 *
 * Pure rules (tests/familyInviteMimo.test.ts) + the DB glue.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import type { ChatMessage } from './assistant/types.js'
import { shoppingWeeksFor } from './businessMetrics.js'
import { familyOfferEligible, loadFamilyOfferInput, stampFamilyOffer, type FamilyOfferInput } from './familyInviteOffers.js'
import { addDays, madridParts, madridWeekStart } from './madridTime.js'

type Db = typeof defaultDb

/** The line Mimo adds (guide text of the proposal: «¿Se la mando también a tu pareja?»). */
export const FAMILY_INVITE_MIMO_LINE =
  'Esta semana ya tienes menú y lista. ¿Se los mando también a tu pareja o a quien vive contigo? Si me dices que sí, te preparo el mensaje con el enlace para que entre en tu casa y lo vea todo.'

/** What the previous reply must contain for a «no» to count as the answer to it. */
export const FAMILY_INVITE_MIMO_MARKER = 'te preparo el mensaje con el enlace para que entre en tu casa'

/** Pure: the resolved weeks (Mondays) from the menus' weeks and the days the list was used. */
export function familyResolvedWeeks(menuWeeks: readonly string[], shoppingDays: readonly string[]): string[] {
  const shopped = new Set(shoppingDays.flatMap((d) => shoppingWeeksFor(d)))
  return [...new Set(menuWeeks)].filter((w) => shopped.has(w)).sort()
}

export interface FamilyMimoOfferInput extends FamilyOfferInput {
  /** Mondays (YYYY-MM-DD, Madrid) of the household's resolved weeks. */
  resolvedWeeks: readonly string[]
  now: Date
}

/** Pure: is it time for Mimo's offer (budget aside)? */
export function shouldOfferFamilyInvite(i: FamilyMimoOfferInput): boolean {
  if (i.state.mimo || i.state.mimoDeclined) return false
  if (i.adults < 2 || !familyOfferEligible(i)) return false
  const week = madridWeekStart(i.now)
  if (i.resolvedWeeks.includes(week)) return true
  // At the weekend, the coming week already resolved (menu for Monday + the weekend shop).
  return madridParts(i.now).weekday >= 5 && i.resolvedWeeks.includes(addDays(week, 7))
}

/** The whole message is a «no» (not «No, cámbiame el jueves», which is about something else). */
const NEGATIVE = /^(no|nop|nope|nah|paso|ahora no|mejor no|de momento no|no hace falta|vivo solo|vivo sola|no me interesa|no quiero)(,? gracias)?$/i

/** Pure: is this message a «no» to the offer Mimo just made? */
export function isFamilyInviteDeclined(message: string, history: readonly ChatMessage[]): boolean {
  const last = [...history].reverse().find((m) => m.role === 'assistant')
  if (!last || !last.content.includes(FAMILY_INVITE_MIMO_MARKER)) return false
  const text = message.trim().replace(/^[¡¿]+/, '').replace(/[.!?]+$/g, '').trim()
  return NEGATIVE.test(text)
}

/** Pure: the reply with the offer at the end. */
export function withFamilyInviteLine(message: string): string {
  const body = message.trimEnd()
  return body ? `${body}\n\n${FAMILY_INVITE_MIMO_LINE}` : FAMILY_INVITE_MIMO_LINE
}

// ─── Weekly aviso budget (D-069) ─────────────────────────────────

/**
 * Decides whether the offer fits in the household's weekly aviso budget and,
 * when it does, spends the unit (kind `family_invite`, priority 4). Called
 * only when everything else says yes, right before stamping.
 */
export type FamilyOfferBudgetGate = (userId: string, channel: 'text' | 'whatsapp', now: Date) => Promise<boolean>

/**
 * TODO(PRO-215): with `services/notifications/budget*.ts` merged, this
 * becomes the PRO-215 budget (planMoment on `[{ kind: 'family_invite' }]`
 * with the priority-1 reserve, then `recordNotices`). Without it, the offer
 * goes (it is a line inside a reply, never a message of its own).
 */
export const familyOfferBudgetGate: FamilyOfferBudgetGate = async () => true

// ─── DB glue ─────────────────────────────────────────────────────

async function loadResolvedWeeks(householdId: string, db: Db): Promise<string[]> {
  const menus = await db.execute(sql`
    SELECT DISTINCT to_char(x.week_start, 'YYYY-MM-DD') AS week
      FROM menus x JOIN users u ON u.id = x.user_id
     WHERE COALESCE(x.household_id, u.primary_household_id) = ${householdId}::uuid
  `)
  const shopping = await db.execute(sql`
    SELECT DISTINCT to_char(x.created_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS day
      FROM activity_events x JOIN users u ON u.id = x.user_id
     WHERE x.kind LIKE 'shopping_%' AND u.primary_household_id = ${householdId}::uuid
  `)
  return familyResolvedWeeks(
    (menus.rows as any[]).map((r) => String(r.week)),
    (shopping.rows as any[]).map((r) => String(r.day)),
  )
}

/** The rule's input from the database (null without a household). Throws on a DB error. */
export async function loadFamilyMimoOfferInput(userId: string, db: Db = defaultDb, now: Date = new Date()): Promise<FamilyMimoOfferInput | null> {
  const base = await loadFamilyOfferInput(userId, db)
  if (!base) return null
  // Only read the weeks when everything else could still say yes.
  const cheapNo = base.state.mimo || base.state.mimoDeclined || base.adults < 2 || !familyOfferEligible(base)
  if (cheapNo) return { ...base, resolvedWeeks: [], now }
  const [u] = (await db.execute(sql`SELECT primary_household_id AS h FROM users WHERE id = ${userId}::uuid`)).rows as any[]
  return { ...base, resolvedWeeks: u?.h ? await loadResolvedWeeks(String(u.h), db) : [], now }
}

/** A «no» right after the offer: off for good. Never throws. */
export async function recordFamilyInviteAnswer(
  userId: string,
  message: string,
  history: readonly ChatMessage[],
  db: Db = defaultDb,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    if (!isFamilyInviteDeclined(message, history)) return false
    await stampFamilyOffer(userId, 'mimoDeclined', db, now)
    return true
  } catch (err) {
    console.warn('[family-invite] answer not recorded:', (err as Error)?.message ?? err)
    return false
  }
}

/**
 * The reply, with the offer at the end when it is due (stamped so it never
 * repeats). Never throws: on any failure the reply goes as it was.
 */
export async function maybeAppendFamilyInviteOffer(
  userId: string,
  reply: string,
  channel: 'text' | 'whatsapp',
  opts: { db?: Db; now?: Date; gate?: FamilyOfferBudgetGate } = {},
): Promise<string> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const gate = opts.gate ?? familyOfferBudgetGate
  try {
    const input = await loadFamilyMimoOfferInput(userId, db, now)
    if (!input || !shouldOfferFamilyInvite(input)) return reply
    if (!(await gate(userId, channel, now))) return reply
    if (!(await stampFamilyOffer(userId, 'mimo', db, now))) return reply
    return withFamilyInviteLine(reply)
  } catch (err) {
    console.warn('[family-invite] skipped:', (err as Error)?.message ?? err)
    return reply
  }
}
