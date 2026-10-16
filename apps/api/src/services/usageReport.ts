/**
 * GET /admin/usage (specs/metrics.md "Usage events"): what households do with
 * Mimoia, day by day, as counts only — no ids, names or text ever leave here.
 *
 * SQL aggregates `usage_events` into (day, name, channel) counts and distinct
 * (household, day, name) triples; the pure builders below turn those into the
 * daily / weekly / funnel blocks and are unit-tested.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { addDays, madridMidnightUtc, madridParts } from './madridTime.js'
import { isoWeekLabel, weekOfDay } from './businessMetrics.js'
import { PASSIVE_USAGE_EVENTS, USAGE_CHANNELS, USAGE_EVENTS, type UsageEventName } from './usageEvents.js'

type Db = typeof defaultDb

export interface UsageCountRow {
  day: string
  name: string
  /** web | whatsapp | voice | null (unknown) */
  channel: string | null
  count: number
}

export interface UsageHouseholdDay {
  householdId: string
  day: string
  name: string
  /** web | whatsapp | voice | null (system / unknown). Optional: only the channel split reads it. */
  channel?: string | null
}

export interface UsageInput {
  days: string[]
  today: string
  counts: UsageCountRow[]
  householdDays: UsageHouseholdDay[]
}

export type EventCounts = Partial<Record<UsageEventName | string, number>>

export interface DailyUsage {
  day: string
  activeHouseholds: number
  events: EventCounts
  byChannel: Record<string, number>
}

export interface WeeklyUsage {
  week: string
  isoWeek: string
  /** The week isn't over yet (or started before the window). */
  partial: boolean
  activeHouseholds: number
  events: EventCounts
}

export interface FunnelWeek {
  week: string
  isoWeek: string
  signups: number
  firstMenu: number
  shoppingListViewed: number
  cooked: number
  /** Signups whose day 7–13 has started (denominator of activeWeek2). */
  week2Eligible: number
  activeWeek2: number
}

const COOKED: ReadonlySet<string> = new Set(['cook_mode_started', 'meal_cooked'])
/** Steps of the activation funnel run in this window: day 0 (signup) … day 6. */
export const FUNNEL_FIRST_WEEK_DAYS = 7

/** Pure: Madrid days from `from` to `to`, inclusive. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export function buildDaily(input: UsageInput): DailyUsage[] {
  const byDay = new Map<string, DailyUsage>(
    input.days.map((day) => [day, { day, activeHouseholds: 0, events: {}, byChannel: {} }]),
  )
  for (const r of input.counts) {
    const d = byDay.get(r.day)
    if (!d) continue
    d.events[r.name] = (d.events[r.name] ?? 0) + r.count
    const ch = r.channel ?? 'unknown'
    d.byChannel[ch] = (d.byChannel[ch] ?? 0) + r.count
  }
  const active = new Map<string, Set<string>>()
  for (const h of input.householdDays) {
    if (!active.has(h.day)) active.set(h.day, new Set())
    active.get(h.day)!.add(h.householdId)
  }
  for (const d of byDay.values()) d.activeHouseholds = active.get(d.day)?.size ?? 0
  return [...byDay.values()]
}

export function buildWeekly(input: UsageInput): WeeklyUsage[] {
  const first = input.days[0]
  const weeks = [...new Set(input.days.map(weekOfDay))]
  const out = new Map<string, WeeklyUsage & { hh: Set<string> }>(
    weeks.map((week) => [
      week,
      {
        week,
        isoWeek: isoWeekLabel(week),
        partial: (first != null && week < first) || addDays(week, 6) > input.today,
        activeHouseholds: 0,
        events: {},
        hh: new Set<string>(),
      },
    ]),
  )
  for (const r of input.counts) {
    const w = out.get(weekOfDay(r.day))
    if (w) w.events[r.name] = (w.events[r.name] ?? 0) + r.count
  }
  for (const h of input.householdDays) out.get(weekOfDay(h.day))?.hh.add(h.householdId)
  return [...out.values()].map(({ hh, ...w }) => ({ ...w, activeHouseholds: hh.size }))
}

/**
 * Pure: weekly activation funnel by signup week. Cohort = households with a
 * `signup_completed` in that ISO week. Nested steps, each within the first 7
 * days (signup day … +6): generated a menu → viewed the shopping list →
 * cooked (cook mode or a meal marked cooked). Then, on its own (not nested),
 * any event on days 7–13 ("still active in week 2"), over the signups whose
 * day 7 has arrived.
 */
export function buildFunnel(input: UsageInput): FunnelWeek[] {
  const signupDay = new Map<string, string>()
  const byHousehold = new Map<string, UsageHouseholdDay[]>()
  for (const h of input.householdDays) {
    if (h.name === 'signup_completed') {
      const prev = signupDay.get(h.householdId)
      if (!prev || h.day < prev) signupDay.set(h.householdId, h.day)
    }
    if (!byHousehold.has(h.householdId)) byHousehold.set(h.householdId, [])
    byHousehold.get(h.householdId)!.push(h)
  }
  const weeks = new Map<string, FunnelWeek>()
  for (const [hh, day0] of signupDay) {
    const week = weekOfDay(day0)
    if (!weeks.has(week)) {
      weeks.set(week, { week, isoWeek: isoWeekLabel(week), signups: 0, firstMenu: 0, shoppingListViewed: 0, cooked: 0, week2Eligible: 0, activeWeek2: 0 })
    }
    const f = weeks.get(week)!
    const evs = byHousehold.get(hh) ?? []
    const inFirstWeek = (pred: (e: UsageHouseholdDay) => boolean) =>
      evs.some((e) => pred(e) && dayDiff(day0, e.day) >= 0 && dayDiff(day0, e.day) < FUNNEL_FIRST_WEEK_DAYS)
    f.signups += 1
    const menu = inFirstWeek((e) => e.name === 'menu_generated')
    const list = menu && inFirstWeek((e) => e.name === 'shopping_list_viewed')
    const cooked = list && inFirstWeek((e) => COOKED.has(e.name))
    if (menu) f.firstMenu += 1
    if (list) f.shoppingListViewed += 1
    if (cooked) f.cooked += 1
    if (dayDiff(day0, input.today) >= FUNNEL_FIRST_WEEK_DAYS) {
      f.week2Eligible += 1
      const w2 = evs.some((e) => {
        const n = dayDiff(day0, e.day)
        return n >= FUNNEL_FIRST_WEEK_DAYS && n < FUNNEL_FIRST_WEEK_DAYS * 2
      })
      if (w2) f.activeWeek2 += 1
    }
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week))
}

export function buildTotals(input: UsageInput) {
  const events: EventCounts = {}
  const byChannel: Record<string, number> = {}
  for (const r of input.counts) {
    events[r.name] = (events[r.name] ?? 0) + r.count
    const ch = r.channel ?? 'unknown'
    byChannel[ch] = (byChannel[ch] ?? 0) + r.count
  }
  const hhByEvent = new Map<string, Set<string>>()
  const all = new Set<string>()
  for (const h of input.householdDays) {
    all.add(h.householdId)
    if (!hhByEvent.has(h.name)) hhByEvent.set(h.name, new Set())
    hhByEvent.get(h.name)!.add(h.householdId)
  }
  const householdsByEvent: EventCounts = {}
  for (const [name, set] of hhByEvent) householdsByEvent[name] = set.size
  return { events, byChannel, activeHouseholds: all.size, householdsByEvent }
}

export interface ChannelSplitWeek {
  week: string
  isoWeek: string
  webOnly: number
  whatsappOnly: number
  both: number
  /** Active only through events without a channel (system: signup…). */
  unknownOnly: number
}

/**
 * Pure (PRO-106): active households per ISO week by the channels they used —
 * only the app/web (voice is Mimo inside the app), only WhatsApp, or both.
 */
export function buildChannelSplit(input: UsageInput): ChannelSplitWeek[] {
  const weeks = [...new Set(input.days.map(weekOfDay))]
  const perWeek = new Map<string, Map<string, { web: boolean; whatsapp: boolean }>>(weeks.map((w) => [w, new Map()]))
  for (const h of input.householdDays) {
    const hh = perWeek.get(weekOfDay(h.day))
    if (!hh) continue
    const cur = hh.get(h.householdId) ?? { web: false, whatsapp: false }
    if (h.channel === 'whatsapp') cur.whatsapp = true
    else if (h.channel === 'web' || h.channel === 'voice') cur.web = true
    hh.set(h.householdId, cur)
  }
  return weeks.map((week) => {
    const out: ChannelSplitWeek = { week, isoWeek: isoWeekLabel(week), webOnly: 0, whatsappOnly: 0, both: 0, unknownOnly: 0 }
    for (const c of perWeek.get(week)!.values()) {
      if (c.web && c.whatsapp) out.both += 1
      else if (c.web) out.webOnly += 1
      else if (c.whatsapp) out.whatsappOnly += 1
      else out.unknownOnly += 1
    }
    return out
  })
}

export interface HouseholdStateRow {
  householdId: string
  /** Counted members (no admin / suspended accounts unless includeInternal). */
  members: number
  whatsappLinked: number
  whatsappNotify: number
  pushEnabled: number
}

/**
 * Pure (PRO-106): how many households have WhatsApp connected, avisos on
 * (WhatsApp with notify, or a push subscription) and 2+ members, right now.
 */
export function buildHouseholdSnapshot(rows: HouseholdStateRow[]) {
  let withWhatsapp = 0
  let withWhatsappNotify = 0
  let withPush = 0
  let withNotices = 0
  let withTwoPlusMembers = 0
  for (const r of rows) {
    if (r.whatsappLinked > 0) withWhatsapp += 1
    if (r.whatsappNotify > 0) withWhatsappNotify += 1
    if (r.pushEnabled > 0) withPush += 1
    if (r.whatsappNotify > 0 || r.pushEnabled > 0) withNotices += 1
    if (r.members >= 2) withTwoPlusMembers += 1
  }
  return { households: rows.length, withWhatsapp, withWhatsappNotify, withPush, withNotices, withTwoPlusMembers }
}

export const USAGE_DEFINITIONS = {
  activeHouseholds: 'Distinct households with at least one usage event that day / ISO week (Europe/Madrid), not counting app_opened_installed (opening the installed app is not using it). Events without a household (deleted accounts) are counted in events but not here.',
  funnel: 'Signup-week cohorts (signup_completed). firstMenu → shoppingListViewed → cooked are nested steps within the first 7 days (signup day … +6): menu_generated, then shopping_list_viewed, then cook_mode_started or meal_cooked. activeWeek2 is not nested: signups with any event on days 7–13, over week2Eligible (signups whose day 7 has arrived).',
  channels: 'web (app and web chat), voice (Mimo with the voice in the app), whatsapp; unknown = system.',
  excluded: 'Admin and suspended accounts are excluded unless includeInternal=1. Events of deleted accounts stay as anonymous counts.',
  retention: 'Events are kept 180 days.',
  households: 'Right now, not windowed. Households with at least one counted member; withWhatsapp = a member has WhatsApp connected; withWhatsappNotify = one with proactive messages on; withPush = a member has a push subscription; withNotices = either; withTwoPlusMembers = 2 or more counted members.',
  channelSplit: 'Active households per ISO week by channel used: webOnly (app, web chat or voice), whatsappOnly, both; unknownOnly = active only through events without a channel.',
  onboardingWhatsappChosen: 'Event onboarding_whatsapp_chosen: «Por WhatsApp» tapped on the first onboarding screen (POST /whatsapp/link-code with from=onboarding); see householdsByEvent for distinct households.',
}

export interface UsageLoadOptions {
  days: number
  includeInternal?: boolean
  now?: Date
}

const TZ = 'Europe/Madrid'

export async function loadUsageReport(opts: UsageLoadOptions, db: Db = defaultDb) {
  const now = opts.now ?? new Date()
  const today = madridParts(now).isoDate
  const fromDay = addDays(today, -(opts.days - 1))
  const from = madridMidnightUtc(fromDay)
  const inc = opts.includeInternal === true
  const counted = sql`(${inc}::boolean OR u.id IS NULL OR (u.role <> 'admin' AND u.suspended_at IS NULL))`
  const dayOf = sql`to_char(e.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD')`

  const countsQ = db.execute(sql`
    SELECT ${dayOf} AS day, e.name, e.channel, COUNT(*)::int AS count
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.created_at >= ${from} AND ${counted}
      GROUP BY 1, 2, 3
  `)
  const householdDaysQ = db.execute(sql`
    SELECT e.household_id::text AS household_id, ${dayOf} AS day, e.name, e.channel
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.created_at >= ${from} AND e.household_id IS NOT NULL AND ${counted}
      GROUP BY 1, 2, 3, 4
  `)
  // Current state per household (PRO-106). Ids stay in this process: only counts leave.
  const member = sql`(${inc}::boolean OR (mu.role <> 'admin' AND mu.suspended_at IS NULL))`
  const householdStateQ = db.execute(sql`
    SELECT hm.household_id::text AS household_id,
           COUNT(DISTINCT mu.id)::int AS members,
           COUNT(DISTINCT wl.user_id)::int AS whatsapp_linked,
           COUNT(DISTINCT wl.user_id) FILTER (WHERE wl.notify)::int AS whatsapp_notify,
           COUNT(DISTINCT ps.user_id)::int AS push_enabled
      FROM household_members hm
      JOIN users mu ON mu.id = hm.user_id
      LEFT JOIN whatsapp_links wl ON wl.user_id = mu.id
      LEFT JOIN push_subscriptions ps ON ps.user_id = mu.id
      WHERE ${member}
      GROUP BY 1
  `)
  const sinceQ = db.execute(sql`SELECT MIN(created_at) AS since FROM usage_events`)
  const [counts, householdDays, since, householdState] = await Promise.all([countsQ, householdDaysQ, sinceQ, householdStateQ])

  const input: UsageInput = {
    days: dayRange(fromDay, today),
    today,
    counts: (counts.rows as any[]).map((r) => ({ day: r.day, name: r.name, channel: r.channel ?? null, count: Number(r.count) })),
    // Passive signals (opening the installed app) are counted in `events` but never make a household active.
    householdDays: (householdDays.rows as any[])
      .filter((r) => !PASSIVE_USAGE_EVENTS.has(r.name))
      .map((r) => ({ householdId: r.household_id, day: r.day, name: r.name, channel: r.channel ?? null })),
  }
  const sinceRaw = (since.rows as any[])[0]?.since
  return {
    generatedAt: now.toISOString(),
    windowDays: opts.days,
    from: fromDay,
    to: today,
    includeInternal: inc,
    eventNames: USAGE_EVENTS,
    channels: USAGE_CHANNELS,
    daily: buildDaily(input),
    weekly: buildWeekly(input),
    funnel: buildFunnel(input),
    totals: buildTotals(input),
    channelSplit: buildChannelSplit(input),
    households: buildHouseholdSnapshot(
      (householdState.rows as any[]).map((r) => ({
        householdId: r.household_id,
        members: Number(r.members),
        whatsappLinked: Number(r.whatsapp_linked),
        whatsappNotify: Number(r.whatsapp_notify),
        pushEnabled: Number(r.push_enabled),
      })),
    ),
    definitions: USAGE_DEFINITIONS,
    dataSince: sinceRaw ? new Date(sinceRaw).toISOString() : null,
  }
}
