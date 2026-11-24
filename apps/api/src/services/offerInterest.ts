/**
 * «Que Mimoia se pague sola» (PRO-389, D-160; specs/billing.md): one card,
 * once per household, in Perfil → Suscripción and in /precios with a session,
 * asking which of the two offers being prepared the household would use.
 *
 * - The answer is a usage event, `offer_interest`, with `option`
 *   (tiendas · carrefour · ninguna) and `where` (suscripcion · precios). Only
 *   those two words: never text (D-094).
 * - Once per household: the first answer of any member closes the card for the
 *   whole household; a second answer is not recorded. The card shows while the
 *   household has no `offer_interest` event (events are kept 180 days, longer
 *   than the question will be asked).
 * - GET /admin/usage → `offerInterest`: households per option, per ISO week
 *   (Europe/Madrid) of the window. Counts only.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { isoWeekLabel, weekOfDay } from './businessMetrics.js'

type Db = typeof defaultDb

export const OFFER_OPTIONS = ['tiendas', 'carrefour', 'ninguna'] as const
export type OfferOption = (typeof OFFER_OPTIONS)[number]
export const OFFER_WHERE = ['suscripcion', 'precios'] as const
export type OfferWhere = (typeof OFFER_WHERE)[number]

/** Pure: the body of POST /usage/offer-interest, from the closed lists only (null = invalid). */
export function offerInterestInput(raw: unknown): { option: OfferOption; where: OfferWhere } | null {
  const b = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const option = (OFFER_OPTIONS as readonly unknown[]).includes(b.option) ? (b.option as OfferOption) : null
  const where = (OFFER_WHERE as readonly unknown[]).includes(b.where) ? (b.where as OfferWhere) : null
  return option && where ? { option, where } : null
}

/** Whether the card still shows to this person: their household hasn't answered. */
export async function offerInterestPending(userId: string, db: Db = defaultDb): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT u.primary_household_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM usage_events e
              WHERE e.household_id = u.primary_household_id AND e.name = 'offer_interest'
           ) AS pending
      FROM users u WHERE u.id = ${userId}::uuid
  `)
  return (r.rows as any[])[0]?.pending === true
}

/** Records the household's answer, once (false = invalid household or already answered). */
export async function recordOfferInterest(
  userId: string,
  answer: { option: OfferOption; where: OfferWhere },
  db: Db = defaultDb,
): Promise<boolean> {
  const r: any = await db.execute(sql`
    INSERT INTO usage_events (user_id, household_id, name, channel, props)
    SELECT u.id, u.primary_household_id, 'offer_interest', 'web', ${JSON.stringify(answer)}::jsonb
      FROM users u
     WHERE u.id = ${userId}::uuid
       AND u.primary_household_id IS NOT NULL
       AND pg_try_advisory_xact_lock(hashtext('offer_interest:' || u.primary_household_id::text))
       AND NOT EXISTS (
         SELECT 1 FROM usage_events e
          WHERE e.household_id = u.primary_household_id AND e.name = 'offer_interest'
       )
  `)
  return Number(r?.rowCount ?? 0) > 0
}

export interface OfferInterestRow {
  /** Madrid day of the answer (YYYY-MM-DD). */
  day: string
  option: string
  households: number
}

export interface OfferInterestWeek {
  /** Monday of the ISO week (Madrid). */
  week: string
  isoWeek: string
  tiendas: number
  carrefour: number
  ninguna: number
  total: number
}

/**
 * Pure: households per option and ISO week, every week of the window's days
 * (zeros included), oldest first, plus the window's totals. A household
 * answers once, so each one counts in a single week and option. Options
 * outside the closed list are dropped.
 */
export function buildOfferInterest(days: readonly string[], rows: readonly OfferInterestRow[]) {
  const empty = (week: string): OfferInterestWeek => ({ week, isoWeek: isoWeekLabel(week), tiendas: 0, carrefour: 0, ninguna: 0, total: 0 })
  const byWeek = new Map([...new Set(days.map(weekOfDay))].map((w) => [w, empty(w)]))
  const totals = { tiendas: 0, carrefour: 0, ninguna: 0, total: 0 }
  for (const r of rows) {
    const option = OFFER_OPTIONS.find((o) => o === r.option)
    const cur = byWeek.get(weekOfDay(r.day))
    if (!option || !cur) continue
    cur[option] += r.households
    cur.total += r.households
    totals[option] += r.households
    totals.total += r.households
  }
  return { weekly: [...byWeek.values()], totals }
}

/** For GET /admin/usage: households per option, per ISO week of the window. Counts only leave. */
export async function loadOfferInterest(days: readonly string[], from: Date, includeInternal: boolean, db: Db = defaultDb) {
  const r = await db.execute(sql`
    SELECT to_char(e.created_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS day,
           e.props->>'option' AS option,
           COUNT(DISTINCT e.household_id)::int AS households
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.name = 'offer_interest' AND e.household_id IS NOT NULL AND e.created_at >= ${from}
       AND (${includeInternal}::boolean OR u.id IS NULL OR (u.role <> 'admin' AND u.suspended_at IS NULL))
     GROUP BY 1, 2
  `)
  return buildOfferInterest(
    days,
    (r.rows as any[]).map((x) => ({ day: String(x.day), option: String(x.option), households: Number(x.households) })),
  )
}
