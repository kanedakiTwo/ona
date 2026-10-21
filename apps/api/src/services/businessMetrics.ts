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
import { loadWaitlistSummary } from './waitlist.js'
import { buildInstalledOpens, buildPushEnabled, deviceCountsFor, loadInstallRows } from './appInstalls.js'
import { NOTICE_DEFINITIONS, loadNoticeMetrics } from './notifications/metrics.js'

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
  /**
   * No user behind it (`cost_events.user_id` NULL: catalogue import, ingredient matching, the
   * daily reviewer…). Reported as `systemCostEur`, never in `costEur` nor in the cost per
   * household (PRO-309, D-108). Absent = false.
   */
  system?: boolean
}

export interface MetricsInput {
  /** Mondays in the window, oldest first. */
  weeks: Week[]
  currentWeek: Week
  /** Households with any meaningful activity in a week. */
  activity: HouseholdWeek[]
  /**
   * Households that have a menu whose `week_start` is that week, with when
   * the household's first menu for that week was created (ISO, PRO-246).
   */
  menus: Array<HouseholdWeek & { firstCreatedAt?: string | null }>
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
  /** Households with a menu whose week_start is this week (PRO-246). */
  menuHouseholds: number
  /** …of which the first one was created before Monday 00:00 Madrid (PRO-246). */
  menuReadyByMondayHouseholds: number
  newHouseholds: number
  costEur: CostBreakdown
  internalCostEur: number
  /** Cost with no user behind it, by provider and feature (PRO-309); not in costEur. */
  systemCostEur: CostBreakdown
  costPerActiveHouseholdEur: number | null
  /** cost_events rows (paid calls) by feature, same accounts as costEur (PRO-247). */
  eventsByFeature: Record<string, number>
  /** cost_events rows by feature with no user behind them (PRO-309). */
  systemEventsByFeature: Record<string, number>
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
 * the menu that starts Monday; Mimoia's shopping reminder fires on Saturday).
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

/** Paid calls (ledger rows) by feature. Pass counted rows only, like costBreakdown. */
function eventsByFeature(rows: CostRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[r.feature] = (out[r.feature] ?? 0) + r.events
  return out
}

/** Who a cost row belongs to: a counted household, an excluded account, or nobody (the system). */
const isSystem = (c: CostRow) => c.system === true
const isCounted = (c: CostRow) => !c.internal && !isSystem(c)
const isInternal = (c: CostRow) => c.internal && !isSystem(c)

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
    const mondayCutoff = madridMidnightUtc(week).getTime()
    const readyByMonday = new Set(
      input.menus
        .filter((m) => m.week === week && m.firstCreatedAt && new Date(m.firstCreatedAt).getTime() < mondayCutoff)
        .map((m) => m.householdId),
    )
    const weekCosts = input.costs.filter((c) => c.week === week)
    const counted = weekCosts.filter(isCounted)
    const system = weekCosts.filter(isSystem)
    const costEur = costBreakdown(counted)
    const internalMicros = weekCosts.filter(isInternal).reduce((s, c) => s + c.micros, 0)
    return {
      week,
      isoWeek: isoWeekLabel(week),
      partial: week === input.currentWeek,
      activeHouseholds,
      resolvedWeekHouseholds: resolved,
      menuHouseholds: menuSet.size,
      menuReadyByMondayHouseholds: readyByMonday.size,
      newHouseholds: signups.get(week)?.size ?? 0,
      costEur,
      internalCostEur: eur(internalMicros),
      systemCostEur: costBreakdown(system),
      costPerActiveHouseholdEur: activeHouseholds > 0 ? Math.round((costEur.total / activeHouseholds) * 10_000) / 10_000 : null,
      eventsByFeature: eventsByFeature(counted),
      systemEventsByFeature: eventsByFeature(system),
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

export interface CampaignMetrics {
  /** Campaign name; null = signed up without a campaign link. */
  campaign: string | null
  signups: number
  /** Active in their signup week. */
  activated: number
  activationRate: number | null
  /** Signups whose week 3 (signup week + 3) has started. */
  week3Eligible: number
  /** Of those, active in week 3. */
  week3Active: number
  week3Rate: number | null
}

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null)

/**
 * Signups in the window grouped by the campaign link they used (PRO-27), so
 * Miguel's circle ("familia", "amigos-padel"…) is read apart from strangers.
 */
export function buildCampaigns(input: MetricsInput, campaignOf: Map<string, string | null>): CampaignMetrics[] {
  const active = groupSets(input.activity)
  const groups = new Map<string | null, HouseholdWeek[]>()
  for (const s of signupWeeks(input.signups)) {
    const c = campaignOf.get(s.householdId) ?? null
    if (!groups.has(c)) groups.set(c, [])
    groups.get(c)!.push(s)
  }
  return [...groups.entries()]
    .map(([campaign, members]) => {
      const activated = members.filter((m) => active.get(m.week)?.has(m.householdId)).length
      const eligible = members.filter((m) => addDays(m.week, 21) <= input.currentWeek)
      const week3Active = eligible.filter((m) => active.get(addDays(m.week, 21))?.has(m.householdId)).length
      return {
        campaign,
        signups: members.length,
        activated,
        activationRate: rate(activated, members.length),
        week3Eligible: eligible.length,
        week3Active,
        week3Rate: rate(week3Active, eligible.length),
      }
    })
    .sort((a, b) => b.signups - a.signups || String(a.campaign).localeCompare(String(b.campaign)))
}

export function buildTotals(input: MetricsInput, weekly: WeeklyMetrics[]) {
  const inWindow = new Set(input.weeks)
  const activeHouseholds = new Set(input.activity.filter((a) => inWindow.has(a.week)).map((a) => a.householdId)).size
  const activeHouseholdWeeks = weekly.reduce((s, w) => s + w.activeHouseholds, 0)
  const windowCosts = input.costs.filter((c) => inWindow.has(c.week))
  const counted = windowCosts.filter(isCounted)
  const system = windowCosts.filter(isSystem)
  const costEur = costBreakdown(counted)
  return {
    activeHouseholds,
    activeHouseholdWeeks,
    newHouseholds: weekly.reduce((s, w) => s + w.newHouseholds, 0),
    resolvedHouseholdWeeks: weekly.reduce((s, w) => s + w.resolvedWeekHouseholds, 0),
    costEur,
    internalCostEur: eur(windowCosts.filter(isInternal).reduce((s, c) => s + c.micros, 0)),
    systemCostEur: costBreakdown(system),
    costPerActiveHouseholdWeekEur:
      activeHouseholdWeeks > 0 ? Math.round((costEur.total / activeHouseholdWeeks) * 10_000) / 10_000 : null,
    eventsByFeature: eventsByFeature(counted),
    systemEventsByFeature: eventsByFeature(system),
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
    'Distinct households with at least one meaningful action in the week: generated a menu, logged a cooked meal, used the shopping list (checked / in-stock / added an item), created a recipe, sent a WhatsApp message to Mimo, or triggered a paid AI feature (talking to Mimo typed or spoken, recipe import, image). Weeks before 2026-10-09 also count OpenAI Realtime voice sessions (retired, D-023). Opening a screen is not tracked.',
  resolvedWeekHouseholds:
    'Households that (a) have a menu whose week_start is that week AND (b) used the shopping list (checked an item, toggled in-stock, or added an item — web or assistant) during that week or the Saturday/Sunday right before it. Opening the list does not count: the list row is rewritten on every read, including by the WhatsApp shopping reminder.',
  menuHouseholds:
    'Households with a menu whose week_start is that week (generated, regenerated or emptied — any menu row for the week). Counts only.',
  menuReadyByMondayHouseholds:
    "Of menuHouseholds, those whose first menu for that week was created before 00:00 of that Monday, Europe/Madrid: they prepared the week before it started. A later regenerate doesn't move the first creation time.",
  newHouseholds: 'Households created (at registration) that week and still primary for a counted user.',
  costEur:
    'Estimated provider cost (EUR) from the cost ledger for counted users, split by provider and feature. Calls with no user behind them (userId null: catalogue import, ingredient matching, the daily conversation reviewer…) are not here but in systemCostEur (PRO-309, D-108). Prices in config/pricing.ts; USD converted with ADVISOR_EUR_PER_USD. WhatsApp service messages sent by Mimo are recorded one row each (feature whatsapp_service): 0 € for the first 1,000 of the month, €0.0166 from the 1,001st.',
  eventsByFeature:
    'Number of cost-ledger rows (cost_events) by feature, for the same accounts as costEur (internal accounts out): one row per paid call, so costEur.byFeature[f] / eventsByFeature[f] is the average cost of one call of that feature. What one call of each feature is: featureDefinitions. Counts only, no user data.',
  systemCostEur:
    'Estimated provider cost (EUR) of the calls with no user behind them (cost_events.user_id null): importing and rewriting catalogue recipes, matching ingredients, the daily conversation reviewer and other system jobs, by provider and feature. Not part of costEur nor of the cost per household, so it does not trigger the per-household cost alert (D-048, D-108). systemEventsByFeature counts its calls.',
  costPerActiveHouseholdEur: 'costEur.total / activeHouseholds for the week (null when no household was active). System cost (systemCostEur) is not included.',
  costPerActiveHouseholdWeekEur: 'Window total costEur / sum of weekly activeHouseholds.',
  cohorts: 'Households grouped by signup week; retention.wK = share of the cohort active in week signup+K (null until that week starts; the current week is partial).',
  dataSince: 'First row in the cost ledger / activity log. Weeks before these dates under-report cost and resolved weeks.',
  errors:
    'In-house error tracker (specs/errors.md), last 7 days by last_seen: newGroups = error groups first seen in the window, activeGroups / openGroups = groups seen (unresolved), events = Σ count of those groups (cumulative, an upper bound). Detail: GET /admin/errors.',
  campaigns:
    'Households that signed up in the window, by the campaign invitation link their first user registered with (null = no link: waitlist invitation, household invitation, admin or open registration). activated = active (see activeHouseholds) in the signup week; week3 = active in signup week + 3, over the signups whose week 3 has started.',
  installedAppHouseholds:
    'Households (counted users) that opened Mimoia as an installed app (display-mode standalone) at least once that week, by device (android / ios / desktop, deduced from the browser; total counts each household once). The web reports at most one open per household and day. Starts when this shipped (PRO-83): earlier weeks read 0.',
  pushEnabledHouseholds:
    'Households (counted users) with push notifications on at the end of the week: a push subscription that still exists today and was created on or before that Sunday, by device (from the browser). Turning notifications off deletes the subscription, so past weeks are a lower bound.',
  notifications: NOTICE_DEFINITIONS,
  waitlist:
    'Pre-launch waitlist (specs/waitlist.md), all time: entries by status, last7Days = signups in the last 7 × 24 h, referredSignups / newsletterOptIns = active entries (not unsubscribed) that came with someone’s link / opted in to the weekly menu email. Segments, sources and the suggested next batch: GET /admin/waitlist.',
} as const

/**
 * What ONE row of each cost-ledger feature is (PRO-247), so a cost per call
 * can be read off costEur.byFeature / eventsByFeature. Shipped in the response
 * as `definitions.featureDefinitions` and mirrored in specs/metrics.md.
 */
export const FEATURE_DEFINITIONS: Record<string, string> = {
  assistant_chat: 'One turn with Mimo in the app (typed or spoken), all its model calls and tools summed into one row.',
  whatsapp_chat: 'One turn with Mimo on WhatsApp (the user wrote; Mimo answered), all its model calls summed.',
  whatsapp_guided:
    'One call to the writer of a message Mimo sends by itself (PRO-156): morning brief, cooking reminder, dinner check-in, shopping reminder, weekly nudge, first steps (end of onboarding). Billed even when its text is rejected and the fixed text goes out. Not counted: messages sent with the fixed text without calling the writer (no model, over the monthly cap).',
  whatsapp_service: 'One free-form WhatsApp message sent by Mimo (reply or proactive inside the 24 h window); 0 € for the first 1,000 of the month.',
  whatsapp_template: 'One template message sent by Mimo outside the 24 h window (Meta utility template).',
  whatsapp_review: 'One call of the daily conversation reviewer (system cost; an admin re-run is another row).',
  voice_note_transcription: 'One WhatsApp voice note transcribed.',
  mimo_voice_transcription: "One recording of the user's voice in the app transcribed (POST /stt).",
  chat_tts: "One of Mimo's replies read aloud (POST /tts).",
  voice_realtime: 'Historical: one OpenAI Realtime voice session (retired 2026-10-09).',
  recipe_extract_photo: 'One recipe read from a photo (web or WhatsApp).',
  recipe_extract_url: 'One recipe read from a link (web or Mimo).',
  recipe_image: 'One photo generated (AiKit gpt-image-2 or OpenAI as reserve); a retry after a failed check is another row.',
  recipe_image_describe: 'One description of the plated dish written before generating its photo.',
  recipe_image_check: 'One check of a generated photo (right dish, house style).',
  ingredient_match: 'One disambiguation of the ingredients of an extracted recipe.',
  unit_fallback: 'One odd unit converted to grams / ml.',
  usda_translation: 'One ingredient name translated for a new ingredient.',
  ingredient_nutrition_estimate: 'One nutrition estimate («Estimar con Mimoia»).',
  onboarding_analysis: 'One analysis of the onboarding answers into the household file.',
  taste_next: 'One choice of the next dish in the taste game.',
  taste_reason: 'One reason the user gave in the taste game read into the household file.',
  shop_quote_parse: "One shop's reply read for a shop order.",
  catalog_import_rewrite: 'One recipe rewritten for the catalogue import (system cost).',
}

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
      -- Paid features the user triggered (Mimo's own WhatsApp messages — templates and service replies — are not the user's activity).
      SELECT COALESCE(ce.household_id, u.primary_household_id), ce.created_at
        FROM cost_events ce JOIN users u ON u.id = ce.user_id
        WHERE ce.feature NOT IN ('whatsapp_template', 'whatsapp_service') AND ce.created_at >= ${from} AND ${counted}
    )
    SELECT ev.hh::text AS household_id, ${weekOf(sql`ev.at`)} AS week
      FROM ev
      WHERE ev.hh IS NOT NULL
      GROUP BY 1, 2
  `)

  const menusQ = db.execute(sql`
    SELECT COALESCE(m.household_id, u.primary_household_id)::text AS household_id, to_char(m.week_start, 'YYYY-MM-DD') AS week,
           MIN(m.created_at) AS first_created_at
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

  const campaignsQ = db.execute(sql`
    SELECT h.id::text AS household_id, MIN(c.name) AS campaign
      FROM households h
      JOIN users u ON u.primary_household_id = h.id
      LEFT JOIN invite_campaigns c ON c.id = u.invite_campaign_id
      WHERE h.created_at >= ${from} AND ${counted}
      GROUP BY h.id
  `)

  const costsQ = db.execute(sql`
    SELECT ${weekOf(sql`ce.created_at`)} AS week,
           ce.provider,
           ce.feature,
           NOT (ce.user_id IS NULL OR u.id IS NULL OR ${counted}) AS internal,
           (ce.user_id IS NULL) AS system,
           COALESCE(SUM(ce.cost_micros), 0)::bigint AS micros,
           COUNT(*)::int AS events,
           COUNT(*) FILTER (WHERE ce.cost_micros IS NULL)::int AS unpriced
      FROM cost_events ce LEFT JOIN users u ON u.id = ce.user_id
      WHERE ce.created_at >= ${from}
      GROUP BY 1, 2, 3, 4, 5
  `)

  const sinceQ = db.execute(sql`
    SELECT (SELECT MIN(created_at) FROM cost_events) AS cost_ledger,
           (SELECT MIN(created_at) FROM activity_events) AS activity_log
  `)

  const [activity, menuRows, shopping, signups, costs, since, errors, waitlist, campaignRows, installs, notifications] = await Promise.all([
    activityQ, menusQ, shoppingQ, signupsQ, costsQ, sinceQ, loadErrorSummary(7, db, now), loadWaitlistSummary(db, now),
    campaignsQ, loadInstallRows({ from, includeInternal: inc }, db),
    loadNoticeMetrics({ weeks, currentWeek: weeks[weeks.length - 1], from, includeInternal: inc }, db),
  ])

  const input: MetricsInput = {
    weeks,
    currentWeek: weeks[weeks.length - 1],
    activity: (activity.rows as any[]).map((r) => ({ householdId: r.household_id, week: r.week })),
    menus: (menuRows.rows as any[]).map((r) => ({
      householdId: r.household_id,
      week: r.week,
      firstCreatedAt: r.first_created_at ? new Date(r.first_created_at).toISOString() : null,
    })),
    shoppingDays: (shopping.rows as any[]).map((r) => ({ householdId: r.household_id, day: r.day })),
    signups: (signups.rows as any[]).map((r) => ({ householdId: r.household_id, day: r.day })),
    costs: (costs.rows as any[]).map((r) => ({
      week: r.week,
      provider: r.provider,
      feature: r.feature,
      internal: Boolean(r.internal),
      system: Boolean(r.system),
      micros: Number(r.micros),
      events: Number(r.events),
      unpriced: Number(r.unpriced),
    })),
  }

  const installedOpens = buildInstalledOpens(weeks, installs.opens)
  const pushEnabled = buildPushEnabled(weeks, installs.subs)
  const weekly = buildWeekly(input).map((w) => ({
    ...w,
    installedAppHouseholds: deviceCountsFor(installedOpens, w.week),
    pushEnabledHouseholds: deviceCountsFor(pushEnabled, w.week),
  }))
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
    campaigns: buildCampaigns(
      input,
      new Map((campaignRows.rows as any[]).map((r) => [r.household_id as string, (r.campaign as string | null) ?? null])),
    ),
    totals: buildTotals(input, weekly),
    errors,
    waitlist,
    notifications,
    definitions: { ...DEFINITIONS, featureDefinitions: FEATURE_DEFINITIONS },
  }
}
