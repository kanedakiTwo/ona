/**
 * Invited households up to their week 3 (PRO-165, D-059; specs/metrics.md
 * «Referidos»). The reward is earned when the invited household resolves a
 * week (a menu generated and the shopping list opened) in its 3rd week since
 * sign-up — days 14 to 20 — not when it signs up. Then a pending reward is
 * left in `referral_rewards`, once per (inviter code, invited account);
 * giving it is PRO-166. Only counts leave this module: never emails or codes.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { madridParts } from './madridTime.js'
import { isoWeekLabel, weekOfDay } from './businessMetrics.js'

type Db = typeof defaultDb

export const WEEK3_FIRST_DAY = 14
export const WEEK3_LAST_DAY = 20

export interface InvitedSignup {
  inviteeUserId: string
  inviteeHouseholdId: string | null
  inviterCode: string
  inviterUserId: string | null
  inviterHouseholdId: string | null
  /** Madrid day of the sign-up, YYYY-MM-DD. */
  signupDay: string
  /** The invited household's events, as (day, name). */
  events: ReadonlyArray<{ day: string; name: string }>
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** Pure: a menu generated and the list opened, both in days 14–20 after sign-up. */
export function week3Resolved(signupDay: string, events: ReadonlyArray<{ day: string; name: string }>): boolean {
  const inWeek3 = (e: { day: string }) => {
    const d = daysBetween(signupDay, e.day)
    return d >= WEEK3_FIRST_DAY && d <= WEEK3_LAST_DAY
  }
  return (
    events.some((e) => e.name === 'menu_generated' && inWeek3(e)) &&
    events.some((e) => e.name === 'shopping_list_viewed' && inWeek3(e))
  )
}

/** Pure: an invitation into the inviter's own household is a member, not another home. */
export function isOtherHousehold(s: Pick<InvitedSignup, 'inviteeHouseholdId' | 'inviterHouseholdId'>): boolean {
  return !(s.inviteeHouseholdId && s.inviterHouseholdId && s.inviteeHouseholdId === s.inviterHouseholdId)
}

/** Pure: who has earned a pending reward. */
export function rewardsEarned(signups: readonly InvitedSignup[]): Array<{ inviterCode: string; inviterUserId: string | null; inviteeUserId: string }> {
  return signups
    .filter((s) => isOtherHousehold(s) && week3Resolved(s.signupDay, s.events))
    .map((s) => ({ inviterCode: s.inviterCode, inviterUserId: s.inviterUserId, inviteeUserId: s.inviteeUserId }))
}

export interface ReferralWeek {
  week: string
  isoWeek: string
  /** Taps on «Invitar a otro hogar» that week (`invite_shared`). */
  inviteShared: number
  /** Sign-ups that week with an inviter (other household). */
  signupsWithInviter: number
  /** Of those, households that resolved a week in their 3rd week. */
  week3Resolved: number
  /** Distinct inviters behind that week's sign-ups. */
  inviters: number
}

/** Pure: the `referrals` block of GET /admin/usage, by sign-up week (counts only). */
export function buildReferralReport(
  signups: readonly InvitedSignup[],
  inviteShared: ReadonlyArray<{ day: string; count: number }>,
): ReferralWeek[] {
  const weeks = new Map<string, ReferralWeek & { codes: Set<string> }>()
  const at = (day: string) => {
    const week = weekOfDay(day)
    if (!weeks.has(week)) {
      weeks.set(week, { week, isoWeek: isoWeekLabel(week), inviteShared: 0, signupsWithInviter: 0, week3Resolved: 0, inviters: 0, codes: new Set() })
    }
    return weeks.get(week)!
  }
  for (const r of inviteShared) at(r.day).inviteShared += r.count
  for (const s of signups) {
    if (!isOtherHousehold(s)) continue
    const w = at(s.signupDay)
    w.signupsWithInviter += 1
    w.codes.add(s.inviterCode)
    if (week3Resolved(s.signupDay, s.events)) w.week3Resolved += 1
  }
  return [...weeks.values()]
    .map(({ codes, ...w }) => ({ ...w, inviters: codes.size }))
    .sort((a, b) => a.week.localeCompare(b.week))
}

const TZ = 'Europe/Madrid'

/** Invited accounts with their household's events (ids stay in this process). */
export async function loadInvitedSignups(db: Db = defaultDb, includeInternal = false): Promise<InvitedSignup[]> {
  const counted = sql`(${includeInternal}::boolean OR (u.role <> 'admin' AND u.suspended_at IS NULL))`
  const res = await db.execute(sql`
    SELECT u.id AS invitee_user_id, u.primary_household_id AS invitee_household_id, u.invited_by_code AS inviter_code,
           to_char(u.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS signup_day,
           inv.id AS inviter_user_id,
           coalesce(inv.primary_household_id, invw.primary_household_id) AS inviter_household_id
      FROM users u
      LEFT JOIN users inv ON inv.referral_code = u.invited_by_code
      LEFT JOIN waitlist_entries w ON w.referral_code = u.invited_by_code
      LEFT JOIN users invw ON inv.id IS NULL AND invw.email = w.email
     WHERE u.invited_by_code IS NOT NULL AND ${counted}
  `)
  const rows = res.rows as any[]
  if (rows.length === 0) return []
  const households = [...new Set(rows.map((r) => r.invitee_household_id).filter(Boolean))] as string[]
  const evRes = households.length
    ? await db.execute(sql`
        SELECT household_id::text AS household_id, to_char(created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, name
          FROM usage_events
         WHERE household_id IN (${sql.join(households.map((h) => sql`${h}::uuid`), sql`, `)})
           AND name IN ('menu_generated', 'shopping_list_viewed')
         GROUP BY 1, 2, 3
      `)
    : { rows: [] }
  const byHousehold = new Map<string, Array<{ day: string; name: string }>>()
  for (const e of evRes.rows as any[]) {
    if (!byHousehold.has(e.household_id)) byHousehold.set(e.household_id, [])
    byHousehold.get(e.household_id)!.push({ day: e.day, name: e.name })
  }
  return rows.map((r) => ({
    inviteeUserId: String(r.invitee_user_id),
    inviteeHouseholdId: r.invitee_household_id ? String(r.invitee_household_id) : null,
    inviterCode: String(r.inviter_code),
    inviterUserId: r.inviter_user_id ? String(r.inviter_user_id) : null,
    inviterHouseholdId: r.inviter_household_id ? String(r.inviter_household_id) : null,
    signupDay: String(r.signup_day),
    events: byHousehold.get(String(r.invitee_household_id)) ?? [],
  }))
}

/** Leave a pending reward for every invited household that reached its week 3 (idempotent). */
export async function recordPendingReferralRewards(db: Db = defaultDb): Promise<number> {
  const earned = rewardsEarned(await loadInvitedSignups(db, true))
  let created = 0
  for (const r of earned) {
    const res = await db.execute(sql`
      INSERT INTO referral_rewards (inviter_code, inviter_user_id, invitee_user_id)
      VALUES (${r.inviterCode}, ${r.inviterUserId}::uuid, ${r.inviteeUserId}::uuid)
      ON CONFLICT (inviter_code, invitee_user_id) DO NOTHING
      RETURNING id
    `)
    created += (res.rows as unknown[]).length
  }
  return created
}

let lastRunHour: string | null = null

/** Scheduler hook: at most once an hour. */
export async function recordPendingReferralRewardsIfDue(now: Date = new Date(), db: Db = defaultDb): Promise<number | null> {
  const p = madridParts(now)
  const hour = `${p.isoDate}T${String(p.hour).padStart(2, '0')}`
  if (hour === lastRunHour) return null
  lastRunHour = hour
  return recordPendingReferralRewards(db)
}

