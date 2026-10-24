/**
 * GET /admin/usage (specs/metrics.md "Usage events"): what households do with
 * Mimoia, day by day, as counts only — no ids, names or text ever leave here.
 *
 * SQL aggregates `usage_events` into (day, name, channel) counts and distinct
 * (household, day, name) triples; the pure builders below turn those into the
 * daily / weekly / funnel blocks and are unit-tested.
 */
import { sql } from 'drizzle-orm'
import { HOUSEHOLD_INVITE_SOURCES, isHouseholdInviteSource, type HouseholdInviteSource } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { addDays, madridMidnightUtc, madridParts } from './madridTime.js'
import { isoWeekLabel, weekOfDay } from './businessMetrics.js'
import { buildReferralReport, loadInvitedSignups } from './referralRewards.js'
import { loadProactiveReport } from './proactiveReport.js'
import { optInDeclinedSql } from './whatsapp/optInOffer.js'
import {
  ONBOARDING_STEPS,
  PASSIVE_USAGE_EVENTS,
  SKILL_CANALES,
  USAGE_CHANNELS,
  USAGE_EVENTS,
  USAGE_SCREENS,
  type SkillCanal,
  type UsageEventName,
} from './usageEvents.js'

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
  /** PRO-248: linked members with avisos off who said no («No, gracias» or BAJA). */
  whatsappDeclined?: number
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
  let withWhatsappDeclined = 0
  let withWhatsappNoAnswer = 0
  for (const r of rows) {
    if (r.whatsappLinked > 0) withWhatsapp += 1
    if (r.whatsappNotify > 0) withWhatsappNotify += 1
    // PRO-248: WhatsApp without avisos splits into «said no» and «didn't answer».
    if (r.whatsappLinked > 0 && r.whatsappNotify === 0) {
      if ((r.whatsappDeclined ?? 0) > 0) withWhatsappDeclined += 1
      else withWhatsappNoAnswer += 1
    }
    if (r.pushEnabled > 0) withPush += 1
    if (r.whatsappNotify > 0 || r.pushEnabled > 0) withNotices += 1
    if (r.members >= 2) withTwoPlusMembers += 1
  }
  return {
    households: rows.length,
    withWhatsapp,
    withWhatsappNotify,
    withWhatsappDeclined,
    withWhatsappNoAnswer,
    withPush,
    withNotices,
    withTwoPlusMembers,
  }
}

export interface FamilyInviteRow {
  /** `household_invites.source` (unknown → casa). */
  source: string
  /** `shared_at` set: «Enviar por WhatsApp» / «Copiar» tapped, or Mimo gave it. */
  shared: boolean
  /** `consumed_at` set: someone joined with it. */
  accepted: boolean
}

export interface FamilyGoalRow {
  /** Adults the household cooks for (the largest `users.adults` among its counted members). */
  adults: number
  /** Counted accounts. */
  members: number
}

interface FamilyInviteCounts {
  prepared: number
  sent: number
  accepted: number
}

/**
 * Pure (PRO-263, D-088): household invitations prepared, sent and accepted
 * per moment (`HOUSEHOLD_INVITE_SOURCES`), all time; and the goal of the
 * proposal: of the households with 2 adults or more, how many already have 2
 * accounts or more. An accepted invite counts as sent (the link got there).
 */
export function buildFamilyInviteReport(invites: readonly FamilyInviteRow[], goalRows: readonly FamilyGoalRow[]) {
  const zero = (): FamilyInviteCounts => ({ prepared: 0, sent: 0, accepted: 0 })
  const bySource = Object.fromEntries(HOUSEHOLD_INVITE_SOURCES.map((k) => [k, zero()])) as Record<HouseholdInviteSource, FamilyInviteCounts>
  const totals = zero()
  for (const i of invites) {
    const key: HouseholdInviteSource = isHouseholdInviteSource(i.source) ? i.source : 'casa'
    const sent = i.shared || i.accepted
    for (const c of [bySource[key], totals]) {
      c.prepared += 1
      if (sent) c.sent += 1
      if (i.accepted) c.accepted += 1
    }
  }
  const base = goalRows.filter((r) => r.adults >= 2)
  const withTwoPlusAdultsAndMembers = base.filter((r) => r.members >= 2).length
  return {
    bySource,
    totals,
    goal: {
      withTwoPlusAdults: base.length,
      withTwoPlusAdultsAndMembers,
      share: base.length ? Math.round((withTwoPlusAdultsAndMembers / base.length) * 1000) / 1000 : null,
    },
  }
}

// ─── PRO-120: sign-up steps, screens and the props of the new events ─────

export interface OnboardingStepRow {
  step: string
  action: string
  /** Distinct people. */
  people: number
}

/**
 * Pure (PRO-120): the web sign-up step by step, in the order it's shown —
 * how many people saw each step and how many got past it, in the window.
 */
export function buildOnboardingSteps(rows: readonly OnboardingStepRow[]) {
  return ONBOARDING_STEPS.map((step) => ({
    step,
    seen: rows.find((r) => r.step === step && r.action === 'visto')?.people ?? 0,
    done: rows.find((r) => r.step === step && r.action === 'hecho')?.people ?? 0,
  }))
}

export interface ScreenDayRow {
  day: string
  screen: string
  /** Rows that day: already one per person and screen (the server's daily cap). */
  count: number
}

/** Pure (PRO-120): people-days per screen and ISO week, most viewed first. */
export function buildScreensWeekly(days: readonly string[], rows: readonly ScreenDayRow[]) {
  const weeks = [...new Set(days.map(weekOfDay))]
  return weeks.map((week) => {
    const counts: Record<string, number> = Object.fromEntries(USAGE_SCREENS.map((k) => [k, 0]))
    for (const r of rows) if (weekOfDay(r.day) === week && r.screen in counts) counts[r.screen] += r.count
    const top = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([screen, views]) => ({ screen, views }))
    return { week, isoWeek: isoWeekLabel(week), screens: counts, top }
  })
}

export interface EventPropRow {
  name: string
  key: string
  value: string
  count: number
}

/** Pure (PRO-120): event → prop → value → count, for the new events (counts only). */
export function buildPropBreakdown(rows: readonly EventPropRow[]) {
  const out: Record<string, Record<string, Record<string, number>>> = {}
  for (const r of rows) {
    const byKey = (out[r.name] ??= {})
    const byValue = (byKey[r.key] ??= {})
    byValue[r.value] = (byValue[r.value] ?? 0) + r.count
  }
  return out
}

export interface MimoSkillRow {
  skill: string
  canal: string | null
  count: number
}

/**
 * Pure (PRO-1022): `mimo_skill_used` per tool in the window, most used first,
 * split by where the conversation was (web, whatsapp, telegram, voice). Counts only.
 */
export function buildMimoSkills(rows: readonly MimoSkillRow[]) {
  const bySkill = new Map<string, Record<SkillCanal, number> & { total: number }>()
  for (const r of rows) {
    const cur = bySkill.get(r.skill) ?? { total: 0, web: 0, whatsapp: 0, telegram: 0, voice: 0 }
    cur.total += r.count
    const canal = SKILL_CANALES.find((c) => c === r.canal)
    if (canal) cur[canal] += r.count
    bySkill.set(r.skill, cur)
  }
  return [...bySkill.entries()]
    .map(([skill, counts]) => ({ skill, ...counts }))
    .sort((a, b) => b.total - a.total || a.skill.localeCompare(b.skill))
}

/** Households by the system of the last browser they came in with (PRO-307). */
export interface HouseholdSystems { android: number; ios: number; desktop: number; unknown: number; total: number }
export interface HouseholdLastDevice { householdId: string; device: string | null }

/**
 * Pure (PRO-307): the active households of the window by the system (`props.device`) of the most
 * recent usage event that carries one — any time in the 180 days kept, not only the window; with
 * none, `unknown` (WhatsApp only, or not seen in the web since this shipped). Counts only.
 */
export function buildHouseholdSystems(active: Iterable<string>, last: readonly HouseholdLastDevice[]): HouseholdSystems {
  const deviceOf = new Map(last.map((l) => [l.householdId, l.device]))
  const out: HouseholdSystems = { android: 0, ios: 0, desktop: 0, unknown: 0, total: 0 }
  for (const h of new Set(active)) {
    const d = deviceOf.get(h)
    const key = d === 'android' || d === 'ios' || d === 'desktop' ? d : 'unknown'
    out[key]++
    out.total++
  }
  return out
}

/** The PRO-120 events whose props are broken down in `breakdown` (`cards` is a number, summed apart). */
export const BREAKDOWN_EVENTS = ['recipe_viewed', 'taste_tuning', 'push_opened', 'alerts_changed', 'feedback_left'] as const

export const USAGE_DEFINITIONS = {
  activeHouseholds: 'Distinct households with at least one usage event that day / ISO week (Europe/Madrid), not counting app_opened_installed (opening the installed app is not using it). Events without a household (deleted accounts) are counted in events but not here.',
  funnel: 'Signup-week cohorts (signup_completed). firstMenu → shoppingListViewed → cooked are nested steps within the first 7 days (signup day … +6): menu_generated, then shopping_list_viewed, then cook_mode_started or meal_cooked. activeWeek2 is not nested: signups with any event on days 7–13, over week2Eligible (signups whose day 7 has arrived).',
  channels: 'web (app and web chat), voice (Mimo with the voice in the app), whatsapp; unknown = system.',
  excluded: 'Admin and suspended accounts are excluded unless includeInternal=1. Events of deleted accounts stay as anonymous counts.',
  retention: 'Events are kept 180 days.',
  households: 'Right now, not windowed. Households with at least one counted member; withWhatsapp = a member has WhatsApp connected; withWhatsappNotify = one with proactive messages on; withWhatsappDeclined / withWhatsappNoAnswer (PRO-248) = WhatsApp but avisos off, split into «said no» («No, gracias» or BAJA by a member) and «did not answer» (the rest); withPush = a member has a push subscription; withNotices = either; withTwoPlusMembers = 2 or more counted members.',
  channelSplit: 'Active households per ISO week by channel used: webOnly (app, web chat or voice), whatsappOnly, both; unknownOnly = active only through events without a channel.',
  onboardingWhatsappChosen: 'Event onboarding_whatsapp_chosen: «Por WhatsApp» tapped on the first onboarding screen (POST /whatsapp/link-code with from=onboarding); see householdsByEvent for distinct households.',
  proactive: 'WhatsApp messages Mimo sends by itself (PRO-156), by ISO week of the window: sent = delivered daily_brief, cooking_reminder, dinner_checkin, shopping_reminder, weekly_nudge and alert; replied = followed by any message from the same number within replyWindowHours; replyRate = replied / sent; guided / fallback = written from the guide vs. the fixed text (rows before PRO-156 count in neither); optouts = BAJA from a linked account. byKind splits the same counts. Counts only.',
  familyInvites: 'Invitations to join the same household (PRO-263, D-088), all time, not the window, by where they were prepared: casa (Perfil → Mi casa, and every invite before 2026-10-20), alta (sign-up), compra (first visit to the shopping list), mimo (web chat or WhatsApp). prepared = created; sent = «Enviar por WhatsApp» / «Copiar» tapped, Mimo gave the link, or accepted; accepted = someone joined with it. Invites made by admin or suspended accounts only with includeInternal=1. goal = of the households with 2 adults or more (largest users.adults among counted members), how many have 2 or more counted accounts; share = that ratio (target 0.3 by 2026-11-23). Counts only.',
  onboardingSteps: 'PRO-120: the web sign-up («Primeros pasos») in the order it is shown: afina («Afina tu menú», only the first time), canal (WhatsApp or the web, only when WhatsApp is available), hogar, frecuencia, cocina, tiempo, dieta, prioridad. seen / done = distinct people in the window with onboarding_step visto / hecho for that step (the server keeps one per person, step and Madrid day). The WhatsApp sign-up is one conversation: see onboarding_whatsapp_chosen, whatsapp_linked and onboarding_completed by channel.',
  screens: 'PRO-120: screen_viewed per ISO week; each row is one person and screen and Madrid day (capped on the server), so views = people-days. top = the screens with views, most viewed first.',
  householdsBySystem:
    'PRO-307: active households of the window (see activeHouseholds) by the system of the last browser they came in with: the most recent usage event with a device (screen_viewed, from the day this shipped, 2026-10-22; or app_opened_installed) — android, ios (iPhone; iPadOS Safari says it is a Mac and counts as desktop), desktop, unknown (no such event: WhatsApp only, or no web visit since). Only that word is stored, never the browser string. Counts only.',
  breakdown: 'PRO-120: for recipe_viewed (from), taste_tuning (action, where), push_opened (kind), alerts_changed (kind, on) and feedback_left (channel: boton, mimo, whatsapp), how many events in the window had each value. tasteCards = cards answered, summed by action. Counts only, never text.',
  mimoSkills: 'PRO-1022: mimo_skill_used in the window, one row per Mimo tool (skill = the tool name) that returned data, most used first: total and by where the conversation was — web (chat in the app), whatsapp, telegram, voice. A tool that failed or found nothing (data null) leaves none. Counts only, never text.',
  referrals: 'By ISO week (inviteShared: of the tap; the rest: of the invited sign-up), all time, not the window. signupsWithInviter = accounts that signed up with someone else’s «Invitar a otro hogar» code (not into the inviter’s own household); week3Resolved = of those, households with a menu generated and the shopping list opened on days 14–20 after signing up; inviters = distinct codes. Counts only.',
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
           COUNT(DISTINCT wl.user_id) FILTER (WHERE NOT wl.notify AND ${optInDeclinedSql()})::int AS whatsapp_declined,
           COUNT(DISTINCT ps.user_id)::int AS push_enabled,
           COALESCE(MAX(mu.adults), 0)::int AS adults
      FROM household_members hm
      JOIN users mu ON mu.id = hm.user_id
      LEFT JOIN whatsapp_links wl ON wl.user_id = mu.id
      LEFT JOIN push_subscriptions ps ON ps.user_id = mu.id
      WHERE ${member}
      GROUP BY 1
  `)
  // Household invitations by moment (PRO-263). Counts only leave this process.
  const familyInvitesQ = db.execute(sql`
    SELECT hi.source, (hi.shared_at IS NOT NULL) AS shared, (hi.consumed_at IS NOT NULL) AS accepted
      FROM household_invites hi JOIN users u ON u.id = hi.invited_by_user_id
      WHERE ${counted}
  `)
  const sinceQ = db.execute(sql`SELECT MIN(created_at) AS since FROM usage_events`)
  // Referrals (PRO-165): every invited account (not just the window) and the taps on «Invitar a otro hogar».
  const invitedQ = loadInvitedSignups(db, inc)
  const inviteSharedQ = db.execute(sql`
    SELECT ${dayOf} AS day, COUNT(*)::int AS count
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.name = 'invite_shared' AND ${counted}
      GROUP BY 1
  `)
  // PRO-120: sign-up steps (distinct people), screens by day, and the new events' props. Counts only leave.
  const onboardingStepsQ = db.execute(sql`
    SELECT e.props->>'step' AS step, e.props->>'action' AS action, COUNT(DISTINCT e.user_id)::int AS people
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.name = 'onboarding_step' AND e.created_at >= ${from} AND ${counted}
      GROUP BY 1, 2
  `)
  const screensQ = db.execute(sql`
    SELECT ${dayOf} AS day, e.props->>'screen' AS screen, COUNT(*)::int AS count
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.name = 'screen_viewed' AND e.created_at >= ${from} AND ${counted}
      GROUP BY 1, 2
  `)
  const breakdownNames = sql.join(BREAKDOWN_EVENTS.map((n) => sql`${n}`), sql`, `)
  const breakdownQ = db.execute(sql`
    SELECT e.name, kv.key, kv.value, COUNT(*)::int AS count
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(e.props, '{}'::jsonb)) AS kv(key, value)
      WHERE e.name IN (${breakdownNames}) AND kv.key <> 'cards' AND e.created_at >= ${from} AND ${counted}
      GROUP BY 1, 2, 3
  `)
  const tasteCardsQ = db.execute(sql`
    SELECT e.props->>'action' AS action, COALESCE(SUM((e.props->>'cards')::numeric), 0)::int AS cards
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.name = 'taste_tuning' AND e.created_at >= ${from} AND ${counted}
      GROUP BY 1
  `)
  // PRO-1022: Mimo's tools by name and canal. Counts only leave.
  const mimoSkillsQ = db.execute(sql`
    SELECT e.props->>'skill' AS skill, e.props->>'canal' AS canal, COUNT(*)::int AS count
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.name = 'mimo_skill_used' AND e.props ? 'skill' AND e.created_at >= ${from} AND ${counted}
      GROUP BY 1, 2
  `)
  // PRO-307: the last device seen per household (any time kept). Ids stay in this process: only counts leave.
  const lastDeviceQ = db.execute(sql`
    SELECT DISTINCT ON (e.household_id) e.household_id::text AS household_id, e.props->>'device' AS device
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.household_id IS NOT NULL AND e.props ? 'device' AND ${counted}
      ORDER BY e.household_id, e.created_at DESC
  `)
  const days = dayRange(fromDay, today)
  const [onboardingStepRows, screenRows, breakdownRows, tasteCardRows, mimoSkillRows] = await Promise.all([
    onboardingStepsQ,
    screensQ,
    breakdownQ,
    tasteCardsQ,
    mimoSkillsQ,
  ])
  const [counts, householdDays, since, householdState, invited, inviteShared, proactive, familyInvites, lastDevice] = await Promise.all([
    countsQ,
    householdDaysQ,
    sinceQ,
    householdStateQ,
    invitedQ,
    inviteSharedQ,
    loadProactiveReport(days, from, inc, db),
    familyInvitesQ,
    lastDeviceQ,
  ])

  const input: UsageInput = {
    days,
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
    householdsBySystem: buildHouseholdSystems(
      input.householdDays.map((h) => h.householdId),
      (lastDevice.rows as any[]).map((r) => ({ householdId: r.household_id, device: r.device ?? null })),
    ),
    households: buildHouseholdSnapshot(
      (householdState.rows as any[]).map((r) => ({
        householdId: r.household_id,
        members: Number(r.members),
        whatsappLinked: Number(r.whatsapp_linked),
        whatsappNotify: Number(r.whatsapp_notify),
        whatsappDeclined: Number(r.whatsapp_declined ?? 0),
        pushEnabled: Number(r.push_enabled),
      })),
    ),
    familyInvites: buildFamilyInviteReport(
      (familyInvites.rows as any[]).map((r) => ({ source: String(r.source), shared: r.shared === true, accepted: r.accepted === true })),
      (householdState.rows as any[]).map((r) => ({ adults: Number(r.adults), members: Number(r.members) })),
    ),
    proactive,
    onboardingSteps: buildOnboardingSteps(
      (onboardingStepRows.rows as any[]).map((r) => ({ step: String(r.step), action: String(r.action), people: Number(r.people) })),
    ),
    screens: buildScreensWeekly(
      days,
      (screenRows.rows as any[]).map((r) => ({ day: r.day, screen: String(r.screen), count: Number(r.count) })),
    ),
    breakdown: buildPropBreakdown(
      (breakdownRows.rows as any[]).map((r) => ({ name: r.name, key: r.key, value: String(r.value), count: Number(r.count) })),
    ),
    tasteCards: Object.fromEntries((tasteCardRows.rows as any[]).map((r) => [String(r.action), Number(r.cards)])),
    mimoSkills: buildMimoSkills(
      (mimoSkillRows.rows as any[]).map((r) => ({ skill: String(r.skill), canal: r.canal ?? null, count: Number(r.count) })),
    ),
    referrals: buildReferralReport(invited, (inviteShared.rows as any[]).map((r) => ({ day: r.day, count: Number(r.count) }))),
    definitions: USAGE_DEFINITIONS,
    dataSince: sinceRaw ? new Date(sinceRaw).toISOString() : null,
  }
}
