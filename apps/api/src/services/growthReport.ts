/**
 * The growth line in GET /admin/usage (PRO-379, D-158; specs/metrics.md):
 * signup → first menu → first hit → two weeks in a row → paying, by signup
 * cohort; where the households stand today with the trial and the plans;
 * and how long the first menu takes.
 *
 * SQL reads one row per household (signup, first events per day, first menu
 * of each week, latest subscription); ids stay in this process and the pure
 * builders below turn them into counts only (D-094). Unit-tested in
 * `growthReport.test.ts`.
 */
import { sql } from 'drizzle-orm'
import { accountAccess, trialDaysFor, type SubscriptionStatus } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { addDays, madridMidnightUtc, madridParts } from './madridTime.js'
import { isoWeekLabel, weekOfDay } from './businessMetrics.js'
import { creatorRefsSql } from './creatorTrial.js'

type Db = typeof defaultDb

/** Days 0…6 from signup: first menu and first hit. */
export const GROWTH_FIRST_WEEK_DAYS = 7
/** Days 0…20 from signup: the two weeks in a row. */
export const GROWTH_TWO_WEEKS_DAYS = 21

/** «Cooked something»: cook mode or a meal marked cooked. */
export const GROWTH_COOKED_EVENTS = ['meal_cooked', 'cook_mode_started'] as const
/** «Used or sent the list»: a ticked item, the list shared (PRO-380), or an order / send to the shop. */
export const GROWTH_LIST_EVENTS = [
  'shopping_item_checked',
  'shopping_list_shared',
  'shop_order_prepared',
  'carrefour_click',
  'basket_extension_sent',
] as const
const GROWTH_EVENTS = ['menu_generated', ...GROWTH_COOKED_EVENTS, ...GROWTH_LIST_EVENTS] as const

/** Paying, for the growth line: a plan with the card left, charged or still in Stripe's trial. */
const PAID_GROWTH: ReadonlySet<string> = new Set(['active', 'trialing'])

export interface GrowthSignup {
  householdId: string
  /** First `signup_completed` of the household (ISO instant). */
  at: string
}

export interface GrowthEvent {
  householdId: string
  name: string
  /** Madrid day. */
  day: string
  /** First one that day (ISO instant). */
  at: string
}

export interface GrowthMenuWeek {
  householdId: string
  /** Monday of the menu's week. */
  week: string
  /** When the first menu for that week was created (ISO instant). */
  firstCreatedAt: string
}

export interface GrowthInput {
  now: Date
  signups: readonly GrowthSignup[]
  events: readonly GrowthEvent[]
  menus: readonly GrowthMenuWeek[]
  /** Latest subscription status per household (none = never subscribed). */
  subscriptions: readonly { householdId: string; status: string }[]
}

export interface GrowthStep {
  /** Households whose window for this step is over. */
  eligible: number
  /** Of those, how many made it. */
  reached: number
  /** Made it already while their window is still open (not in `reached`). */
  reachedInOpenWindow: number
}

export interface GrowthCohort {
  week: string
  isoWeek: string
  signups: number
  firstMenu: GrowthStep
  firstHit: GrowthStep
  /** PRO-1148: the cooking half of firstHit alone (same window, same eligible). */
  firstHitCooked: GrowthStep
  /** PRO-1148: the list half of firstHit alone (same window, same eligible). */
  firstHitList: GrowthStep
  twoWeeks: GrowthStep
  paid: GrowthStep
}

export interface TimeToFirstMenu {
  week: string
  isoWeek: string
  signups: number
  /** Signups with a menu_generated after signing up (the minutes below are theirs). */
  withMenu: number
  medianMinutes: number | null
  p90Minutes: number | null
}

const COOKED: ReadonlySet<string> = new Set(GROWTH_COOKED_EVENTS)
const LIST: ReadonlySet<string> = new Set(GROWTH_LIST_EVENTS)

const madridDay = (iso: string) => madridParts(new Date(iso)).isoDate

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

const zeroStep = (): GrowthStep => ({ eligible: 0, reached: 0, reachedInOpenWindow: 0 })

function tally(step: GrowthStep, windowOver: boolean, reached: boolean): void {
  if (windowOver) {
    step.eligible += 1
    if (reached) step.reached += 1
  } else if (reached) step.reachedInOpenWindow += 1
}

/**
 * Pure: two ISO weeks in a row, both starting (Monday) on days 0…20 from
 * signup, each with its first menu created before 00:00 of its Monday,
 * Europe/Madrid (as `menuReadyByMondayHouseholds` in /admin/metrics).
 */
export function hasTwoWeeksInARow(day0: string, menus: readonly GrowthMenuWeek[]): boolean {
  const ready = new Set(
    menus
      .filter((m) => {
        const n = dayDiff(day0, m.week)
        return n >= 0 && n < GROWTH_TWO_WEEKS_DAYS && Date.parse(m.firstCreatedAt) < madridMidnightUtc(m.week).getTime()
      })
      .map((m) => m.week),
  )
  return [...ready].some((w) => ready.has(addDays(w, 7)))
}

function groupBy<T extends { householdId: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    if (!out.has(r.householdId)) out.set(r.householdId, [])
    out.get(r.householdId)!.push(r)
  }
  return out
}

/** The first signup per household (a household that signed up twice counts once, on the first). */
function firstSignups(signups: readonly GrowthSignup[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of signups) {
    const prev = out.get(s.householdId)
    if (!prev || Date.parse(s.at) < Date.parse(prev)) out.set(s.householdId, s.at)
  }
  return out
}

/**
 * Pure (PRO-379): the growth line by signup cohort (ISO week of the signup,
 * Madrid). Steps are not nested: each one counts on its own. Each step only
 * counts in `reached` once its window is over (`eligible`); what already
 * happened inside an open window goes to `reachedInOpenWindow`.
 */
export function buildGrowth(input: GrowthInput): GrowthCohort[] {
  const today = madridParts(input.now).isoDate
  const events = groupBy(input.events)
  const menus = groupBy(input.menus)
  const status = new Map(input.subscriptions.map((s) => [s.householdId, s.status]))
  const cohorts = new Map<string, GrowthCohort>()
  for (const [hh, at] of firstSignups(input.signups)) {
    const day0 = madridDay(at)
    const week = weekOfDay(day0)
    if (!cohorts.has(week)) {
      cohorts.set(week, { week, isoWeek: isoWeekLabel(week), signups: 0, firstMenu: zeroStep(), firstHit: zeroStep(), firstHitCooked: zeroStep(), firstHitList: zeroStep(), twoWeeks: zeroStep(), paid: zeroStep() })
    }
    const c = cohorts.get(week)!
    const evs = events.get(hh) ?? []
    const inFirstWeek = (names: ReadonlySet<string>) =>
      evs.some((e) => names.has(e.name) && dayDiff(day0, e.day) >= 0 && dayDiff(day0, e.day) < GROWTH_FIRST_WEEK_DAYS)
    const elapsed = dayDiff(day0, today)
    const firstWeekOver = elapsed >= GROWTH_FIRST_WEEK_DAYS
    const cooked = inFirstWeek(COOKED)
    const list = inFirstWeek(LIST)
    c.signups += 1
    tally(c.firstMenu, firstWeekOver, inFirstWeek(new Set(['menu_generated'])))
    tally(c.firstHit, firstWeekOver, cooked && list)
    tally(c.firstHitCooked, firstWeekOver, cooked)
    tally(c.firstHitList, firstWeekOver, list)
    tally(c.twoWeeks, elapsed >= GROWTH_TWO_WEEKS_DAYS, hasTwoWeeksInARow(day0, menus.get(hh) ?? []))
    tally(c.paid, true, PAID_GROWTH.has(status.get(hh) ?? ''))
  }
  return [...cohorts.values()].sort((a, b) => a.week.localeCompare(b.week))
}

/** Pure: the median (mean of the two middle values when even) and p90 (nearest rank), rounded to minutes. */
export function medianAndP90(values: readonly number[]): { median: number | null; p90: number | null } {
  if (values.length === 0) return { median: null, p90: null }
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  const p90 = s[Math.ceil(0.9 * s.length) - 1]
  return { median: Math.round(median), p90: Math.round(p90) }
}

/** Pure (PRO-379): minutes from signup_completed to the first menu_generated after it, by signup cohort. */
export function buildTimeToFirstMenu(input: Pick<GrowthInput, 'signups' | 'events'>): TimeToFirstMenu[] {
  const firstMenu = new Map<string, number[]>()
  for (const e of input.events) {
    if (e.name !== 'menu_generated') continue
    if (!firstMenu.has(e.householdId)) firstMenu.set(e.householdId, [])
    firstMenu.get(e.householdId)!.push(Date.parse(e.at))
  }
  const byWeek = new Map<string, { signups: number; minutes: number[] }>()
  for (const [hh, at] of firstSignups(input.signups)) {
    const week = weekOfDay(madridDay(at))
    const w = byWeek.get(week) ?? { signups: 0, minutes: [] }
    w.signups += 1
    const start = Date.parse(at)
    const after = (firstMenu.get(hh) ?? []).filter((t) => t >= start)
    if (after.length) w.minutes.push((Math.min(...after) - start) / 60_000)
    byWeek.set(week, w)
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, w]) => {
      const { median, p90 } = medianAndP90(w.minutes)
      return { week, isoWeek: isoWeekLabel(week), signups: w.signups, withMenu: w.minutes.length, medianMinutes: median, p90Minutes: p90 }
    })
}

export interface TrialHouseholdRow {
  householdId: string
  /** `households.created_at` (ISO instant). */
  createdAt: string | null
  /** `trialDaysFor(…)`: 14, or 28 with a creator's link. */
  trialDays: number
  /** Latest subscription (by `updated_at`); null = never subscribed. */
  latestStatus: string | null
  cancelAtPeriodEnd: boolean
}

export interface TrialReport {
  /** Before launch day (2026-12-15): everyone without a plan is in the beta. */
  beta: number
  /** In the trial, without card. */
  inTrial: number
  /** Card left, Stripe trial running (no charge yet). */
  withCard: number
  /** Charged: `active`. */
  paying: number
  /** Trial over without a plan. */
  paused: number
  /** Plan Gratis (PRO-385): 0 until it ships; until then they are in `paused`. */
  free: number
  /** Of withCard + paying, those cancelling at the end of the period. */
  cancelScheduled: number
  /** Failed payment: `past_due` (or `unpaid`). */
  pastDue: number
  /** Households whose latest subscription ended (`canceled`), by reason (PRO-386: until then, unknown). */
  cancellations: { total: number; byReason: Record<string, number> }
}

/**
 * Pure (PRO-379): where each counted household stands today. Exclusive states
 * (beta, inTrial, withCard, paying, paused, free, pastDue) add up to the
 * households; cancelScheduled and cancellations count across them.
 */
export function buildTrialReport(rows: readonly TrialHouseholdRow[], now: Date): TrialReport {
  const out: TrialReport = { beta: 0, inTrial: 0, withCard: 0, paying: 0, paused: 0, free: 0, cancelScheduled: 0, pastDue: 0, cancellations: { total: 0, byReason: {} } }
  for (const r of rows) {
    const s = r.latestStatus
    if (s === 'trialing' || s === 'active') {
      if (s === 'trialing') out.withCard += 1
      else out.paying += 1
      if (r.cancelAtPeriodEnd) out.cancelScheduled += 1
    } else if (s === 'past_due' || s === 'unpaid') {
      out.pastDue += 1
    } else {
      const state = accountAccess({ householdCreatedAt: r.createdAt, paid: false, now, trialDays: r.trialDays }).state
      if (state === 'beta') out.beta += 1
      else if (state === 'trial') out.inTrial += 1
      else out.paused += 1
    }
    if (s === 'canceled') {
      out.cancellations.total += 1
      out.cancellations.byReason.unknown = (out.cancellations.byReason.unknown ?? 0) + 1
    }
  }
  return out
}

export const GROWTH_DEFINITIONS = {
  growth:
    'PRO-379, D-158: the growth line by signup cohort (ISO week of the household’s first signup_completed, Europe/Madrid), every signup kept (180 days), not the window. Steps are not nested. firstMenu = menu_generated on days 0–6 from signup; firstHit = on days 0–6, cooked (meal_cooked or cook_mode_started) and used or sent the list (shopping_item_checked, shopping_list_shared, shop_order_prepared, carrefour_click or basket_extension_sent); firstHitCooked and firstHitList (PRO-1148) = each half of firstHit on its own, same days 0–6 and same eligible: cooked, or used or sent the list (firstHit is both; its definition does not change); twoWeeks = two consecutive ISO weeks whose Mondays fall on days 0–20 from signup, each with its first menu created before 00:00 of its Monday (as menuReadyByMondayHouseholds in /admin/metrics); paid = the household’s latest subscription is active or trialing (a plan with the card left) today. eligible = households whose window is over (day 7 for firstMenu, firstHit, firstHitCooked and firstHitList, day 21 for twoWeeks; paid has no window: every signup); reached counts only among eligible; reachedInOpenWindow = already made it inside an open window. Counts only.',
  trial:
    'PRO-379: every household with a counted member, today, by its latest subscription and the trial rule (accountAccess): beta (before launch day, no plan), inTrial (trial without card), withCard (trialing: card left, not charged yet), paying (active), paused (trial over without a plan), free (plan Gratis, PRO-385: 0 until it ships), pastDue (past_due or unpaid). Those seven add up to the households. cancelScheduled = of withCard and paying, cancelling at the end of the period; cancellations = households whose latest subscription is canceled, byReason (PRO-386: until then all unknown). Counts only.',
  timeToFirstMenu:
    'PRO-379: by signup cohort (as growth), minutes from the household’s first signup_completed to its first menu_generated after it, any time later: medianMinutes and p90Minutes (nearest rank) over withMenu (signups that have one). Counts only.',
}

export async function loadGrowthReport(opts: { includeInternal: boolean; now: Date }, db: Db = defaultDb) {
  const inc = opts.includeInternal
  const TZ = 'Europe/Madrid'
  const counted = sql`(${inc}::boolean OR u.id IS NULL OR (u.role <> 'admin' AND u.suspended_at IS NULL))`
  const member = sql`(${inc}::boolean OR (mu.role <> 'admin' AND mu.suspended_at IS NULL))`
  const signupHouseholds = sql`(
    SELECT e.household_id FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.name = 'signup_completed' AND e.household_id IS NOT NULL AND ${counted}
  )`
  const names = sql.join(GROWTH_EVENTS.map((n) => sql`${n}`), sql`, `)

  const signupsQ = db.execute(sql`
    SELECT e.household_id::text AS household_id, MIN(e.created_at) AS at
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.name = 'signup_completed' AND e.household_id IS NOT NULL AND ${counted}
      GROUP BY 1
  `)
  const eventsQ = db.execute(sql`
    SELECT e.household_id::text AS household_id, e.name, to_char(e.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, MIN(e.created_at) AS at
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.name IN (${names}) AND e.household_id IN ${signupHouseholds} AND ${counted}
      GROUP BY 1, 2, 3
  `)
  const menusQ = db.execute(sql`
    SELECT COALESCE(m.household_id, u.primary_household_id)::text AS household_id, to_char(m.week_start, 'YYYY-MM-DD') AS week,
           MIN(m.created_at) AS first_created_at
      FROM menus m JOIN users u ON u.id = m.user_id
      WHERE COALESCE(m.household_id, u.primary_household_id) IN ${signupHouseholds} AND ${counted}
      GROUP BY 1, 2
  `)
  // Every household with a counted member, its trial length and latest subscription. Ids stay here.
  const householdsQ = db.execute(sql`
    SELECT h.id::text AS household_id, h.created_at, ${creatorRefsSql('h')} AS creator_refs,
           s.status, COALESCE(s.cancel_at_period_end, false) AS cancel_at_period_end
      FROM households h
      LEFT JOIN LATERAL (
        SELECT status, cancel_at_period_end FROM subscriptions WHERE household_id = h.id ORDER BY updated_at DESC LIMIT 1
      ) s ON true
      WHERE EXISTS (
        SELECT 1 FROM household_members hm JOIN users mu ON mu.id = hm.user_id WHERE hm.household_id = h.id AND ${member}
      )
  `)
  const [signups, events, menus, households] = await Promise.all([signupsQ, eventsQ, menusQ, householdsQ])

  const iso = (v: unknown) => new Date(v as string).toISOString()
  const trialRows: TrialHouseholdRow[] = (households.rows as any[]).map((r) => ({
    householdId: r.household_id,
    createdAt: r.created_at ? iso(r.created_at) : null,
    trialDays: trialDaysFor(r.creator_refs ?? null),
    latestStatus: (r.status as SubscriptionStatus | null) ?? null,
    cancelAtPeriodEnd: r.cancel_at_period_end === true,
  }))
  const input: GrowthInput = {
    now: opts.now,
    signups: (signups.rows as any[]).map((r) => ({ householdId: r.household_id, at: iso(r.at) })),
    events: (events.rows as any[]).map((r) => ({ householdId: r.household_id, name: r.name, day: r.day, at: iso(r.at) })),
    menus: (menus.rows as any[])
      .filter((r) => r.first_created_at)
      .map((r) => ({ householdId: r.household_id, week: r.week, firstCreatedAt: iso(r.first_created_at) })),
    subscriptions: trialRows.filter((r) => r.latestStatus).map((r) => ({ householdId: r.householdId, status: r.latestStatus! })),
  }
  return {
    growth: buildGrowth(input),
    trial: buildTrialReport(trialRows, opts.now),
    timeToFirstMenu: buildTimeToFirstMenu(input),
  }
}
