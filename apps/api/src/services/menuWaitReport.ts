/**
 * PRO-1298: how long a household waits for a menu Mimo makes, by ISO week
 * (Madrid), for GET /admin/usage → `menuWait`. Read from the turns Mimo
 * already keeps (`whatsapp_messages` inbound rows and the web chat's
 * assistant rows in `chat_messages`): `meta.ms` is the whole turn (from the
 * message to the reply) and, since PRO-1298, each `meta.toolTrace` entry
 * carries the tool's own `ms`. Only durations leave this file: no text, no
 * ids. The goal (Mimo's quality, 23-nov): a menu in under a minute.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { addDays, madridMidnightUtc, madridParts } from './madridTime.js'
import { isoWeekLabel, weekOfDay } from './businessMetrics.js'

const TZ = 'Europe/Madrid'
/** The wait the household should never pass (seconds). */
export const MENU_WAIT_GOAL_S = 60

const GENERATE = 'generate_weekly_menu'
const SIGNUP = 'complete_onboarding'

export interface MenuTurnRow {
  /** Madrid day of the turn, YYYY-MM-DD. */
  day: string
  /** Whole turn, ms (null on rows without it). */
  ms: number | null
  tools: readonly string[]
  trace: ReadonlyArray<{ name?: unknown; ms?: unknown; error?: unknown; unchanged?: unknown }> | null
}

export interface WaitStats {
  /** Turns (or tool runs) measured. */
  n: number
  /** Median and 95th percentile, seconds with one decimal; null with no samples. */
  p50S: number | null
  p95S: number | null
  /** How many took over MENU_WAIT_GOAL_S. */
  over60: number
}

export interface MenuWaitWeek {
  week: string
  isoWeek: string
  /** generate_weekly_menu itself (the tool), from PRO-1298 on. */
  generate: WaitStats
  /** The whole turn in which generate_weekly_menu made a menu. */
  generateTurn: WaitStats
  /** complete_onboarding itself (the sign-up's first menu), from PRO-1298 on. */
  signup: WaitStats
  /** The sign-up's last step: the whole turn that ran complete_onboarding (WhatsApp). */
  signupTurn: WaitStats
}

/** Pure: nearest-rank percentile of sorted values. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]
}

const seconds = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10)

/** Pure: p50 / p95 / over the goal of durations in ms. */
export function waitStats(samples: readonly number[]): WaitStats {
  const sorted = samples.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b)
  return {
    n: sorted.length,
    p50S: seconds(percentile(sorted, 50)),
    p95S: seconds(percentile(sorted, 95)),
    over60: sorted.filter((v) => v > MENU_WAIT_GOAL_S * 1000).length,
  }
}

/**
 * Pure: the week's samples. A tool run counts only when it made a menu (no
 * error, not «the week already had one»); a turn counts when one of its runs
 * did (or, on rows from before the trace, when it called the tool).
 */
export function buildMenuWait(weeks: readonly string[], rows: readonly MenuTurnRow[]): MenuWaitWeek[] {
  const byWeek = new Map(weeks.map((w) => [w, { generate: [] as number[], generateTurn: [] as number[], signup: [] as number[], signupTurn: [] as number[] }]))
  for (const row of rows) {
    const bucket = byWeek.get(weekOfDay(row.day))
    if (!bucket) continue
    for (const [tool, own, turn] of [[GENERATE, bucket.generate, bucket.generateTurn], [SIGNUP, bucket.signup, bucket.signupTurn]] as const) {
      if (!row.tools.includes(tool)) continue
      const runs = (row.trace ?? []).filter((t) => t?.name === tool)
      const made = runs.filter((t) => t.error !== true && t.unchanged !== true)
      for (const t of made) if (typeof t.ms === 'number') own.push(t.ms)
      if ((runs.length === 0 || made.length > 0) && typeof row.ms === 'number') turn.push(row.ms)
    }
  }
  return weeks.map((week) => {
    const b = byWeek.get(week)!
    return {
      week,
      isoWeek: isoWeekLabel(week),
      generate: waitStats(b.generate),
      generateTurn: waitStats(b.generateTurn),
      signup: waitStats(b.signup),
      signupTurn: waitStats(b.signupTurn),
    }
  })
}

export const MENU_WAIT_DEFINITION =
  'PRO-1298: how long a menu made by Mimo takes, per ISO week (Madrid; the last `weeks`, oldest first), from the turns Mimo keeps (WhatsApp inbound rows and the web chat; Telegram keeps no durations). generate = generate_weekly_menu itself, the tool (from 2026-11-24 on); generateTurn = the whole turn in which it made a menu, from the message arriving to the reply; signup = complete_onboarding itself, the WhatsApp sign-up\'s first menu (from 2026-11-24 on); signupTurn = the sign-up\'s last step, the whole turn that ran it. Runs that made no menu (an error, the week already had one) don\'t count. n = how many, p50S / p95S = median and 95th percentile in seconds (nearest rank), over60 = how many over 60 s, the goal. Durations only; no text, no ids.'

export interface MenuWaitOptions {
  weeks?: number
  includeInternal?: boolean
  now?: Date
}

export async function loadMenuWaitReport(opts: MenuWaitOptions = {}, db: any = defaultDb) {
  const now = opts.now ?? new Date()
  const count = Math.min(Math.max(opts.weeks ?? 8, 1), 26)
  const thisWeek = weekOfDay(madridParts(now).isoDate)
  const weeks = Array.from({ length: count }, (_, i) => addDays(thisWeek, -7 * (count - 1 - i)))
  const from = madridMidnightUtc(weeks[0])
  const inc = opts.includeInternal === true
  const counted = sql`(${inc}::boolean OR u.id IS NULL OR (u.role <> 'admin' AND u.suspended_at IS NULL))`
  const menuTools = sql`ARRAY[${GENERATE}, ${SIGNUP}]`
  const result = await db.execute(sql`
    SELECT to_char(m.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, m.meta->'ms' AS ms, m.meta->'tools' AS tools, m.meta->'toolTrace' AS trace
      FROM whatsapp_messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.direction = 'in' AND m.status = 'processed' AND m.created_at >= ${from}
        AND jsonb_typeof(m.meta->'tools') = 'array' AND (m.meta->'tools') ?| ${menuTools} AND ${counted}
    UNION ALL
    SELECT to_char(m.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD'), m.meta->'ms', m.meta->'tools', m.meta->'toolTrace'
      FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.role = 'assistant' AND m.created_at >= ${from}
        AND jsonb_typeof(m.meta->'tools') = 'array' AND (m.meta->'tools') ?| ${menuTools} AND ${counted}
  `)
  const rows: MenuTurnRow[] = (result.rows as any[]).map((r) => ({
    day: String(r.day),
    ms: typeof r.ms === 'number' ? r.ms : r.ms != null && Number.isFinite(Number(r.ms)) ? Number(r.ms) : null,
    tools: Array.isArray(r.tools) ? r.tools.map(String) : [],
    trace: Array.isArray(r.trace) ? r.trace : null,
  }))
  return { goalS: MENU_WAIT_GOAL_S, weeks: buildMenuWait(weeks, rows), definition: MENU_WAIT_DEFINITION }
}
