/**
 * PRO-216 (D-069): how the weekly aviso budget behaves, for the Monday review
 * in /ona-semana. The `notifications` block of GET /admin/metrics
 * (specs/metrics.md): per ISO week, the avisos Mimo could have sent and what
 * happened to them, by kind and by priority, plus how many were answered
 * and how many households said BAJA or switched a kind off. Aggregates only.
 *
 * `buildNoticeMetrics` is pure (noticeMetrics.test.ts); `loadNoticeMetrics`
 * runs the SQL.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../../db/connection.js'
import { addDays } from '../madridTime.js'
import type { NoticeOutcome } from './budget.js'

type Db = typeof defaultDb

/** Monday (YYYY-MM-DD) of an ISO week. */
type Week = string

/** `YYYY-Www` (same rule as businessMetrics' `isoWeekLabel`; kept here to avoid an import cycle). */
function isoWeekLabel(monday: Week): string {
  const thursday = new Date(`${addDays(monday, 3)}T12:00:00Z`)
  const year = thursday.getUTCFullYear()
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1, 12)) / (7 * 86_400_000)) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

export interface NoticeCountRow {
  week: Week
  kind: string
  priority: number
  outcome: NoticeOutcome | string
  count: number
  /** Of those, sent by WhatsApp and answered by the person within 12 h. */
  answered: number
}

export interface NoticeCounts {
  candidates: number
  sent: number
  merged: number
  droppedByBudget: number
  outsideWindow: number
  failed: number
  answered: number
}

export interface NoticeWeek extends NoticeCounts {
  week: Week
  isoWeek: string
  partial: boolean
  /** Households with at least one candidate aviso that week. */
  householdsWithNotices: number
  byKind: Record<string, NoticeCounts>
  byPriority: Record<string, NoticeCounts>
  /** Priority-1 avisos dropped by the budget: should be 0 (if not, raise the budget or drop kinds). */
  priority1Dropped: number
  /** Households that wrote BAJA (all WhatsApp avisos off) that week. */
  optOutHouseholds: number
  /** Households that switched off avisos (one kind or all) from the app or by asking Mimo. */
  kindOffHouseholds: number
}

export interface NoticeMetricsInput {
  weeks: Week[]
  currentWeek: Week
  counts: NoticeCountRow[]
  householdsByWeek: Map<Week, number>
  optOutsByWeek: Map<Week, number>
  kindOffsByWeek: Map<Week, number>
}

const empty = (): NoticeCounts => ({ candidates: 0, sent: 0, merged: 0, droppedByBudget: 0, outsideWindow: 0, failed: 0, answered: 0 })

function add(into: NoticeCounts, r: NoticeCountRow): void {
  into.candidates += r.count
  into.answered += r.answered
  if (r.outcome === 'enviado') into.sent += r.count
  else if (r.outcome === 'fusionado') into.merged += r.count
  else if (r.outcome === 'descartado_tope') into.droppedByBudget += r.count
  else if (r.outcome === 'fuera_ventana') into.outsideWindow += r.count
  else if (r.outcome === 'fallido') into.failed += r.count
}

/** Pure: the weekly `notifications` block, oldest week first. */
export function buildNoticeMetrics(input: NoticeMetricsInput): NoticeWeek[] {
  return input.weeks.map((week) => {
    const rows = input.counts.filter((r) => r.week === week)
    const total = empty()
    const byKind: Record<string, NoticeCounts> = {}
    const byPriority: Record<string, NoticeCounts> = {}
    let priority1Dropped = 0
    for (const r of rows) {
      add(total, r)
      add((byKind[r.kind] ??= empty()), r)
      add((byPriority[String(r.priority)] ??= empty()), r)
      if (r.priority === 1 && r.outcome === 'descartado_tope') priority1Dropped += r.count
    }
    return {
      week,
      isoWeek: isoWeekLabel(week),
      partial: week === input.currentWeek,
      householdsWithNotices: input.householdsByWeek.get(week) ?? 0,
      ...total,
      byKind,
      byPriority,
      priority1Dropped,
      optOutHouseholds: input.optOutsByWeek.get(week) ?? 0,
      kindOffHouseholds: input.kindOffsByWeek.get(week) ?? 0,
    }
  })
}

export const NOTICE_DEFINITIONS =
  'Avisos Mimo sends by itself under the weekly budget (PRO-215, specs/notifications.md): candidates = every aviso that could have gone out; sent = the message that went out; merged = went inside another aviso’s message (same moment, one message); droppedByBudget = left out by the 4-a-week budget; outsideWindow = Meta’s 24 h window closed and no template; failed = send error or no channel. answered = sent or merged by WhatsApp and the person wrote within 12 h. priority1Dropped should be 0. optOutHouseholds = wrote BAJA; kindOffHouseholds = switched avisos off (a kind or all) in the app or through Mimo. enabledHouseholdsNow = current state (no history of switches).'

const TZ = 'Europe/Madrid'

/** Block for GET /admin/metrics. `counted` is the shared users filter (admins/suspended out unless includeInternal). */
export async function loadNoticeMetrics(
  opts: { weeks: Week[]; currentWeek: Week; from: Date; includeInternal: boolean },
  db: Db = defaultDb,
) {
  const inc = opts.includeInternal
  const counted = sql`(${inc}::boolean OR (u.role <> 'admin' AND u.suspended_at IS NULL))`
  const fromWeek = opts.weeks[0]
  const weekOf = (col: ReturnType<typeof sql>) => sql`to_char(date_trunc('week', ${col} AT TIME ZONE ${TZ}), 'YYYY-MM-DD')`

  const [counts, households, optOuts, kindOffs, enabled] = await Promise.all([
    db.execute(sql`
      SELECT nc.week, nc.kind, nc.priority, nc.outcome, COUNT(*)::int AS count,
             COUNT(*) FILTER (
               WHERE nc.outcome IN ('enviado', 'fusionado') AND nc.channel IN ('whatsapp', 'both')
                 AND EXISTS (
                   SELECT 1 FROM whatsapp_messages w
                    WHERE w.user_id = nc.user_id AND w.direction = 'in'
                      AND w.created_at > nc.moment_at AND w.created_at < nc.moment_at + interval '12 hours'
                 )
             )::int AS answered
        FROM notice_candidates nc JOIN users u ON u.id = nc.user_id
       WHERE nc.week >= ${fromWeek} AND ${counted}
       GROUP BY 1, 2, 3, 4
    `),
    db.execute(sql`
      SELECT nc.week, COUNT(DISTINCT nc.budget_key)::int AS n
        FROM notice_candidates nc JOIN users u ON u.id = nc.user_id
       WHERE nc.week >= ${fromWeek} AND ${counted}
       GROUP BY 1
    `),
    db.execute(sql`
      SELECT ${weekOf(sql`w.created_at`)} AS week, COUNT(DISTINCT COALESCE(u.primary_household_id, u.id))::int AS n
        FROM whatsapp_messages w JOIN users u ON u.id = w.user_id
       WHERE w.direction = 'out' AND w.kind = 'optout' AND w.created_at >= ${opts.from} AND ${counted}
       GROUP BY 1
    `),
    db.execute(sql`
      SELECT ${weekOf(sql`e.created_at`)} AS week, COUNT(DISTINCT COALESCE(e.household_id, u.primary_household_id, u.id))::int AS n
        FROM usage_events e JOIN users u ON u.id = e.user_id
       WHERE e.name = 'notifications_off' AND e.created_at >= ${opts.from} AND ${counted}
       GROUP BY 1
    `),
    db.execute(sql`
      SELECT
        (SELECT COUNT(DISTINCT COALESCE(u.primary_household_id, u.id))::int FROM whatsapp_links l JOIN users u ON u.id = l.user_id
          WHERE l.notify AND ${counted}) AS whatsapp,
        (SELECT COUNT(DISTINCT COALESCE(u.primary_household_id, u.id))::int FROM push_subscriptions p JOIN users u ON u.id = p.user_id
          WHERE ${counted}) AS push,
        (SELECT COUNT(DISTINCT hh)::int FROM (
           SELECT COALESCE(u.primary_household_id, u.id) AS hh FROM whatsapp_links l JOIN users u ON u.id = l.user_id WHERE l.notify AND ${counted}
           UNION
           SELECT COALESCE(u.primary_household_id, u.id) FROM push_subscriptions p JOIN users u ON u.id = p.user_id WHERE ${counted}
         ) x) AS total
    `),
  ])
  const byWeek = (rows: any[]) => new Map<Week, number>(rows.map((r) => [r.week as string, Number(r.n)]))
  const weekly = buildNoticeMetrics({
    weeks: opts.weeks,
    currentWeek: opts.currentWeek,
    counts: (counts.rows as any[]).map((r) => ({
      week: r.week,
      kind: r.kind,
      priority: Number(r.priority),
      outcome: r.outcome,
      count: Number(r.count),
      answered: Number(r.answered),
    })),
    householdsByWeek: byWeek(households.rows as any[]),
    optOutsByWeek: byWeek(optOuts.rows as any[]),
    kindOffsByWeek: byWeek(kindOffs.rows as any[]),
  })
  const e = (enabled.rows[0] ?? {}) as { whatsapp?: number; push?: number; total?: number }
  return {
    enabledHouseholdsNow: { whatsapp: Number(e.whatsapp ?? 0), push: Number(e.push ?? 0), total: Number(e.total ?? 0) },
    weekly,
  }
}
