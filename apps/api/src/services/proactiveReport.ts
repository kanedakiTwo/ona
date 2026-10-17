/**
 * The `proactive` block of GET /admin/usage (PRO-156, specs/metrics.md):
 * how people answer the messages Mimo sends by itself over WhatsApp and how
 * many turn them off with BAJA. Counts only, by ISO week (Europe/Madrid).
 *
 *   - sent: proactive messages delivered (`whatsapp_messages`, direction out,
 *     status sent, kinds in `PROACTIVE_REPORT_KINDS`);
 *   - replied: of those, the ones followed by any message from the same
 *     number within `REPLY_WINDOW_HOURS` (6 h);
 *   - guided / fallback: written from their guide vs. the fixed text
 *     (`meta.guided`, since PRO-156; older rows count in neither);
 *   - optouts: BAJA from a linked account (outbound `optout` rows with a user).
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { isoWeekLabel, weekOfDay } from './businessMetrics.js'

type Db = typeof defaultDb

export const PROACTIVE_REPORT_KINDS = ['daily_brief', 'cooking_reminder', 'dinner_checkin', 'shopping_reminder', 'weekly_nudge', 'alert'] as const
export const REPLY_WINDOW_HOURS = 6

export interface ProactiveRow {
  day: string
  kind: string
  /** 'guide' | 'fallback' | '' (before PRO-156). */
  guided: string
  replied: boolean
  count: number
}

export interface ProactiveCounts {
  sent: number
  replied: number
  replyRate: number | null
  guided: number
  fallback: number
}

export interface ProactiveWeek extends ProactiveCounts {
  week: string
  isoWeek: string
  optouts: number
  byKind: Record<string, ProactiveCounts>
}

const empty = (): ProactiveCounts => ({ sent: 0, replied: 0, replyRate: null, guided: 0, fallback: 0 })
const rate = (c: ProactiveCounts) => ({ ...c, replyRate: c.sent ? Math.round((c.replied / c.sent) * 1000) / 1000 : null })

function add(c: ProactiveCounts, r: ProactiveRow): void {
  c.sent += r.count
  if (r.replied) c.replied += r.count
  if (r.guided === 'guide') c.guided += r.count
  if (r.guided === 'fallback') c.fallback += r.count
}

/** Pure: rows → one entry per ISO week of the window (oldest first), plus totals. */
export function buildProactiveReport(days: readonly string[], rows: readonly ProactiveRow[], optouts: ReadonlyArray<{ day: string; count: number }>) {
  const weeks = new Map<string, ProactiveWeek>()
  for (const week of new Set(days.map(weekOfDay))) {
    weeks.set(week, { week, isoWeek: isoWeekLabel(week), ...empty(), optouts: 0, byKind: {} })
  }
  const totals = { ...empty(), optouts: 0 }
  for (const r of rows) {
    const w = weeks.get(weekOfDay(r.day))
    if (!w) continue
    add(w, r)
    add(totals, r)
    add((w.byKind[r.kind] ??= empty()), r)
  }
  for (const o of optouts) {
    const w = weeks.get(weekOfDay(o.day))
    if (!w) continue
    w.optouts += o.count
    totals.optouts += o.count
  }
  return {
    replyWindowHours: REPLY_WINDOW_HOURS,
    weekly: [...weeks.values()].map((w) => ({
      ...rate(w),
      byKind: Object.fromEntries(Object.entries(w.byKind).map(([k, c]) => [k, rate(c)])),
    })),
    totals: rate(totals),
  }
}

const TZ = 'Europe/Madrid'

/** Loader: `from` is the window's first Madrid midnight; `inc` keeps admins and suspended accounts. */
export async function loadProactiveReport(days: readonly string[], from: Date, inc: boolean, db: Db = defaultDb) {
  const counted = sql`(${inc}::boolean OR u.id IS NULL OR (u.role <> 'admin' AND u.suspended_at IS NULL))`
  const dayOf = sql`to_char(m.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD')`
  const kinds = sql.join(PROACTIVE_REPORT_KINDS.map((k) => sql`${k}`), sql`, `)
  const [sent, optouts] = await Promise.all([
    db.execute(sql`
      SELECT ${dayOf} AS day, m.kind, COALESCE(m.meta->>'guided', '') AS guided,
             EXISTS (
               SELECT 1 FROM whatsapp_messages i
                WHERE i.phone = m.phone AND i.direction = 'in'
                  AND i.created_at > m.created_at
                  AND i.created_at <= m.created_at + make_interval(hours => ${REPLY_WINDOW_HOURS})
             ) AS replied,
             COUNT(*)::int AS count
        FROM whatsapp_messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.direction = 'out' AND m.status = 'sent' AND m.kind IN (${kinds})
         AND m.created_at >= ${from} AND ${counted}
       GROUP BY 1, 2, 3, 4
    `),
    db.execute(sql`
      SELECT ${dayOf} AS day, COUNT(*)::int AS count
        FROM whatsapp_messages m JOIN users u ON u.id = m.user_id
       WHERE m.direction = 'out' AND m.kind = 'optout' AND m.created_at >= ${from} AND ${counted}
       GROUP BY 1
    `),
  ])
  return buildProactiveReport(
    days,
    (sent.rows as any[]).map((r) => ({ day: r.day, kind: r.kind, guided: r.guided ?? '', replied: r.replied === true || r.replied === 't', count: Number(r.count) })),
    (optouts.rows as any[]).map((r) => ({ day: r.day, count: Number(r.count) })),
  )
}
