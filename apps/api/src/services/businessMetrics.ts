/**
 * Business metrics for GET /admin/metrics (specs/metrics.md): weekly active
 * households, "resolved weeks", signups, cost per active household, and
 * signup cohorts — per ISO week on the Europe/Madrid clock.
 *
 * Split in two:
 *   - `loadBusinessMetrics` runs a handful of SQL aggregates that return only
 *     distinct (household, week|day) pairs and per-week cost sums;
 *   - the pure `build*` functions below apply every rule, so they are
 *     unit-tested without a database (businessMetrics.test.ts).
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { addDays, madridMidnightUtc, madridWeekStart } from './madridTime.js'
import { loadErrorSummary } from './appErrors.js'

type Db = typeof defaultDb

/** Monday (YYYY-MM-DD) of an ISO week. */
export type Week = string
export interface HouseholdWeek { householdId: string; week: Week }
/** `day` is a Europe/Madrid calendar date (YYYY-MM-DD). */
export interface HouseholdDay { householdId: string; day: string }
export interface CostRow {
  week: Week
  provider: string
  feature: string
  micros: number
  events: number
  /** Events whose model had no price (cost_micros NULL). */
  unpriced: number
  /** Spent by an excluded account (admin / suspended). */
  internal: boolean
}

export interface MetricsInput {
  /** Mondays in the window, oldest first. */
  weeks: Week[]
  currentWeek: Week
  /** Households with any meaningful activity in a week. */
  activity: HouseholdWeek[]
  /** Households that have a menu whose `week_start` is that week. */
  menus: HouseholdWeek[]
  /** Days a household interacted with its shopping list. */
  shoppingDays: HouseholdDay[]
  /** Household creation day. */
  signups: HouseholdDay[]
  costs: CostRow[]
}

export interface CostBreakdown {
  total: number
  byProvider: Record<string, number>
  byFeature: Record<string, number>
}

export interface WeeklyMetrics {
  week: Week
  isoWeek: string
  /** The current, still-running week. */
  partial: boolean
  activeHouseholds: number
  resolvedWeekHouseholds: number
  newHouseholds: number
  costEur: CostBreakdown
  internalCostEur: number
  costPerActiveHouseholdEur: number | null
}

export interface CohortMetrics {
  week: Week
  isoWeek: string
  size: number
  retention: { w1: number | null; w2: number | null; w3: number | null; w4: number | null }
}

// ─── Pure helpers ────────────────────────────────────────────────

/** Monday of the ISO week containing a calendar date. */
export function weekOfDay(day: string): Week {
  const d = new Date(`${day}T12:00:00Z`)
  const weekday = (d.getUTCDay() + 6) % 7 // 0 = Monday
  return addDays(day, -weekday)
}

/** `YYYY-Www` with the ISO week-numbering year (the Thursday's year). */
export function isoWeekLabel(monday: Week): string {
  const thursday = new Date(`${addDays(monday, 3)}T12:00:00Z`)
  const year = thursday.getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1, 12)
  const week = Math.floor((thursday.getTime() - jan1) / (7 * 86_400_000)) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** The last `n` Mondays on the Madrid clock, oldest first, ending with the current week. */
export function lastWeekStarts(now: Date, n: number): Week[] {
  const current = madridWeekStart(now)
  return Array.from({ length: n }, (_, i) => addDays(current, (i - (n - 1)) * 7))
}

/**
 * Which menu weeks a shopping-list interaction counts for: its own week, and
 * — on Saturday/Sunday — also the coming week (people shop at the weekend for
 * the menu that starts Monday; ONA's shopping reminder fires on Saturday).
 */
export function shoppingWeeksFor(day: string): Week[] {
  const week = weekOfDay(day)
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
  return weekday >= 5 ? [week, addDays(week, 7)] : [week]
}

const eur = (micros: number) => Math.round(micros / 100) / 10_000 // micro-€ → € (4 decimals)

function groupSets(pairs: HouseholdWeek[]): Map<Week, Set<string>> {
  const out = new Map<Week, Set<string>>()
  for (const p of pairs) {
    if (!out.has(p.week)) out.set(p.week, new Set())
    out.get(p.week)!.add(p.householdId)
  }
  return out
}

function costBreakdown(rows: CostRow[]): CostBreakdown {
  const byProvider: Record<string, number> = {}
  const byFeature: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    total += r.micros
    byProvider[r.provider] = (byProvider[r.provider] ?? 0) + r.micros
    byFeature[r.feature] = (byFeature[r.feature] ?? 0) + r.micros
  }
  const toEur = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, eur(v)]))
  return { total: eur(total), byProvider: toEur(byProvider), byFeature: toEur(byFeature) }
}

const signupWeeks = (signups: HouseholdDay[]): HouseholdWeek[] =>
  signups.map((s) => ({ householdId: s.householdId, week: weekOfDay(s.day) }))

export function buildWeekly(input: MetricsInput): WeeklyMetrics[] {
  const active = groupSets(input.activity)
  const menus = groupSets(input.menus)
  const shopped = groupSets(
    input.shoppingDays.flatMap((s) => shoppingWeeksFor(s.day).map((week) => ({ householdId: s.householdId, week }))),
  )
  const signups = groupSets(signupWeeks(input.signups))

  return input.weeks.map((week) => {
    const activeHouseholds = active.get(week)?.size ?? 0
    const menuSet = menus.get(week) ?? new Set<string>()
    const shopSet = shopped.get(week) ?? new Set<string>()
    const resolved = [...menuSet].filter((h) => shopSet.has(h)).length
    const weekCosts = input.costs.filter((c) => c.week === week)
    const costEur = costBreakdown(weekCosts.filter((c) => !c.internal))
    const internalMicros = weekCosts.filter((c) => c.internal).reduce((s, c) => s + c.micros, 0)
    return {
      week,
      isoWeek: isoWeekLabel(week),
      partial: week === input.currentWeek,
      activeHouseholds,
      resolvedWeekHouseholds: resolved,
      newHouseholds: signups.get(week)?.size ?? 0,
      costEur,
      internalCostEur: eur(internalMicros),
      costPerActiveHouseholdEur: activeHouseholds > 0 ? Math.round((costEur.total / activeHouseholds) * 10_000) / 10_000 : null,
    }
  })
}

/**
 * Households grouped by signup week (within the window). Retention Wk = share
 * of the cohort active in week signup+k; null while that week hasn't started.
 */
export function buildCohorts(input: MetricsInput): CohortMetrics[] {
  const inWindow = new Set(input.weeks)
  const active = groupSets(input.activity)
  const cohorts = groupSets(signupWeeks(input.signups))
  return input.weeks
    .filter((week) => inWindow.has(week) && (cohorts.get(week)?.size ?? 0) > 0)
    .map((week) => {
      const members = cohorts.get(week)!
      const at = (k: number): number | null => {
        const target = addDays(week, 7 * k)
        if (target > input.currentWeek) return null
        const act = active.get(target) ?? new Set<string>()
        const kept = [...members].filter((h) => act.has(h)).length
        return Math.round((kept / members.size) * 10_000) / 10_000
      }
      return { week, isoWeek: isoWeekLabel(week), size: members.size, retention: { w1: at(1), w2: at(2), w3: at(3), w4: at(4) } }
    })
}

export function buildTotals(input: MetricsInput, weekly: WeeklyMetrics[]) {
  const inWindow = new Set(input.weeks)
  const activeHouseholds = new Set(input.activity.filter((a) => inWindow.has(a.week)).map((a) => a.householdId)).size
  const activeHouseholdWeeks = weekly.reduce((s, w) => s + w.activeHouseholds, 0)
  const windowCosts = input.costs.filter((c) => inWindow.has(c.week))
  const costEur = costBreakdown(windowCosts.filter((c) => !c.internal))
  return {
    activeHouseholds,
    activeHouseholdWeeks,
    newHouseholds: weekly.reduce((s, w) => s + w.newHouseholds, 0),
    resolvedHouseholdWeeks: weekly.reduce((s, w) => s + w.resolvedWeekHouseholds, 0),
    costEur,
    internalCostEur: eur(windowCosts.filter((c) => c.internal).reduce((s, c) => s + c.micros, 0)),
    costPerActiveHouseholdWeekEur:
      activeHouseholdWeeks > 0 ? Math.round((costEur.total / activeHouseholdWeeks) * 10_000) / 10_000 : null,
    costEvents: windowCosts.reduce((s, c) => s + c.events, 0),
    unpricedCostEvents: windowCosts.reduce((s, c) => s + c.unpriced, 0),
  }
}

/** Plain-language definitions shipped in every response (and in specs/metrics.md). */
export const DEFINITIONS = {
  week: 'ISO week (Monday–Sunday) on the Europe/Madrid clock. `week` is the Monday; the current week is `partial`.',
  household: "A household that is the primary household of at least one counted user. Activity is attributed to the user's current primary household (or the row's own household_id when it has one).",
  excluded:
    'Admin accounts (role=admin) and suspended users are excluded from every count and from costEur; their spend is reported as internalCostEur. There is no demo-account flag. `includeInternal=1` counts them.',
  activeHouseholds:
    'Distinct households with at least one meaningful action in the week: generated a menu, logged a cooked meal, used the shopping list (checked / in-stock / added an item), created a recipe, sent a WhatsApp message to ONA, spoke in voice mode, or triggered a paid AI feature (chat, voice, recipe import, image). Opening a screen is not tracked.',
  resolvedWeekHouseholds:
    'Households that (a) have a menu whose week_start is that week AND (b) used the shopping list (checked an item, toggled in-stock, or added an item — web or assistant) during that week or the Saturday/Sunday right before it. Opening the list does not count: the list row is rewritten on every read, including by the WhatsApp shopping reminder.',
  newHouseholds: 'Households created (at registration) that week and still primary for a counted user.',
  costEur:
    'Estimated provider cost (EUR) from the cost ledger for counted users plus system jobs (userId null, e.g. the daily conversation reviewer), split by provider and feature. Prices in config/pricing.ts; USD converted with ADVISOR_EUR_PER_USD. Free WhatsApp service replies are not costs.',
  costPerActiveHouseholdEur: 'costEur.total / activeHouseholds for the week (null when no household was active).',
  costPerActiveHouseholdWeekEur: 'Window total costEur / sum of weekly activeHouseholds.',
  cohorts: 'Households grouped by signup week; retention.wK = share of the cohort active in week signup+K (null until that week starts; the current week is partial).',
  dataSince: 'First row in the cost ledger / activity log. Weeks before these dates under-report cost and resolved weeks.',
  errors:
    'In-house error tracker (specs/errors.md), last 7 days by last_seen: newGroups = error groups first seen in the window, activeGroups / openGroups = groups seen (unresolved), events = Σ count of those groups (cumulative, an upper bound). Detail: GET /admin/errors.',
} as const

// ─── SQL loader ──────────────────────────────────────────────────

export interface LoadOptions {
  weeks: number
  includeInternal: boolean
  now?: Date
}

const TZ = 'Europe/Madrid'

export async function loadBusinessMetrics(opts: LoadOptions, db: Db = defaultDb) {
  const now = opts.now ?? new Date()
  const weeks = lastWeekStarts(now, opts.weeks)
  const fromDay = weeks[0]
  const from = madridMidnightUtc(fromDay)
  const inc = opts.includeInternal

  // Counted users (admins / suspended excluded unless includeInternal).
  const counted = sql`(${inc}::boolean OR (u.role <> 'admin' AND u.suspended_at IS NULL))`
  const weekOf = (col: ReturnType<typeof sql>) => sql`to_char(date_trunc('week', ${col} AT TIME ZONE ${TZ}), 'YYYY-MM-DD')`
  const dayOf = (col: ReturnType<typeof sql>) => sql`to_char(${col} AT TIME ZONE ${TZ}, 'YYYY-MM-DD')`

  const activityQ = db.execute(sql`
    WITH ev AS (
      SELECT COALESCE(m.household_id, u.primary_household_id) AS hh, m.created_at AS at
        FROM menus m JOIN users u ON u.id = m.user_id WHERE m.created_at >= ${from} AND ${counted}
      UNION ALL
      SELECT COALESCE(c.household_id, u.primary_household_id), c.created_at
        FROM cook_logs c JOIN users u ON u.id = c.user_id WHERE c.created_at >= ${from} AND ${counted}
      UNION ALL
      SELECT COALESCE(a.household_id, u.primary_household_id), a.created_at
        FROM activity_events a JOIN users u ON u.id = a.user_id WHERE a.created_at >= ${from} AND ${counted}
      UNION ALL
      SELECT u.primary_household_id, r.created_at
        FROM recipes r JOIN users u ON u.id = r.author_id WHERE r.created_at >= ${from} AND ${counted}
      UNION ALL
      SELECT u.primary_household_id, w.created_at
        FROM whatsapp_messages w JOIN users u ON u.id = w.user_id
        WHERE w.direction = 'in' AND w.created_at >= ${from} AND ${counted}
      UNION ALL
      SELECT u.primary_household_id, v.created_at
        FROM voice_transcripts v JOIN users u ON u.id = v.user_id
        WHERE v.role = 'user' AND v.created_at >= ${from} AND ${counted}
      UNION ALL
      -- Paid features the user triggered (proactive templates are ONA's initiative, not activity).
      SELECT COALESCE(ce.household_id, u.primary_household_id), ce.created_at
        FROM cost_events ce JOIN users u ON u.id = ce.user_id
        WHERE ce.feature <> 'whatsapp_template' AND ce.created_at >= ${from} AND ${counted}
    )
    SELECT ev.hh::text AS household_id, ${weekOf(sql`ev.at`)} AS week
      FROM ev
      WHERE ev.hh IS NOT NULL
      GROUP BY 1, 2
  `)

  const menusQ = db.execute(sql`
    SELECT COALESCE(m.household_id, u.primary_household_id)::text AS household_id, to_char(m.week_start, 'YYYY-MM-DD') AS week
      FROM menus m JOIN users u ON u.id = m.user_id
      WHERE m.week_start >= ${fromDay}::date AND ${counted}
        AND COALESCE(m.household_id, u.primary_household_id) IS NOT NULL
      GROUP BY 1, 2
  `)

  // From the Saturday before the window so a weekend shop counts for week 1.
  const shoppingQ = db.execute(sql`
    SELECT COALESCE(a.household_id, u.primary_household_id)::text AS household_id, ${dayOf(sql`a.created_at`)} AS day
      FROM activity_events a JOIN users u ON u.id = a.user_id
      WHERE a.kind LIKE 'shopping_%' AND a.created_at >= ${madridMidnightUtc(addDays(fromDay, -2))} AND ${counted}
        AND COALESCE(a.household_id, u.primary_household_id) IS NOT NULL
      GROUP BY 1, 2
  `)

  const signupsQ = db.execute(sql`
    SELECT h.id::text AS household_id, ${dayOf(sql`h.created_at`)} AS day
      FROM households h
      WHERE h.created_at >= ${from}
        AND EXISTS (SELECT 1 FROM users u WHERE u.primary_household_id = h.id AND ${counted})
  `)

  const costsQ = db.execute(sql`
    SELECT ${weekOf(sql`ce.created_at`)} AS week,
           ce.provider,
           ce.feature,
           NOT (ce.user_id IS NULL OR u.id IS NULL OR ${counted}) AS internal,
           COALESCE(SUM(ce.cost_micros), 0)::bigint AS micros,
           COUNT(*)::int AS events,
           COUNT(*) FILTER (WHERE ce.cost_micros IS NULL)::int AS unpriced
      FROM cost_events ce LEFT JOIN users u ON u.id = ce.user_id
      WHERE ce.created_at >= ${from}
      GROUP BY 1, 2, 3, 4
  `)

  const sinceQ = db.execute(sql`
    SELECT (SELECT MIN(created_at) FROM cost_events) AS cost_ledger,
           (SELECT MIN(created_at) FROM activity_events) AS activity_log
  `)

  const [activity, menuRows, shopping, signups, costs, since, errors] = await Promise.all([
    activityQ, menusQ, shoppingQ, signupsQ, costsQ, sinceQ, loadErrorSummary(7, db, now),
  ])

  const input: MetricsInput = {
    weeks,
    currentWeek: weeks[weeks.length - 1],
    activity: (activity.rows as any[]).map((r) => ({ householdId: r.household_id, week: r.week })),
    menus: (menuRows.rows as any[]).map((r) => ({ householdId: r.household_id, week: r.week })),
    shoppingDays: (shopping.rows as any[]).map((r) => ({ householdId: r.household_id, day: r.day })),
    signups: (signups.rows as any[]).map((r) => ({ householdId: r.household_id, day: r.day })),
    costs: (costs.rows as any[]).map((r) => ({
      week: r.week,
      provider: r.provider,
      feature: r.feature,
      internal: Boolean(r.internal),
      micros: Number(r.micros),
      events: Number(r.events),
      unpriced: Number(r.unpriced),
    })),
  }

  const weekly = buildWeekly(input)
  const sinceRow = (since.rows[0] ?? {}) as { cost_ledger?: Date | string | null; activity_log?: Date | string | null }
  const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null)
  return {
    generatedAt: now.toISOString(),
    timezone: TZ,
    weeks: opts.weeks,
    includeInternal: inc,
    dataSince: { costLedger: iso(sinceRow.cost_ledger), activityLog: iso(sinceRow.activity_log) },
    weekly,
    cohorts: buildCohorts(input),
    totals: buildTotals(input, weekly),
    errors,
    definitions: DEFINITIONS,
  }
}
