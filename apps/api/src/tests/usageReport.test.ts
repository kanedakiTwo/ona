/**
 * GET /admin/usage pure builders (specs/metrics.md "Usage events"): daily and
 * weekly counts, active households, and the activation funnel.
 */
import { describe, expect, it } from 'vitest'
import {
  buildChannelSplit,
  buildDaily,
  buildFunnel,
  buildHouseholdSnapshot,
  buildTotals,
  buildWeekly,
  dayRange,
  type UsageInput,
} from '../services/usageReport.js'

const hd = (householdId: string, day: string, name: string) => ({ householdId, day, name })

describe('dayRange', () => {
  it('is inclusive and crosses months', () => {
    expect(dayRange('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
  })
})

describe('daily / weekly / totals', () => {
  const input: UsageInput = {
    days: dayRange('2026-10-05', '2026-10-13'),
    today: '2026-10-13',
    counts: [
      { day: '2026-10-05', name: 'mimo_message', channel: 'whatsapp', count: 4 },
      { day: '2026-10-05', name: 'mimo_message', channel: 'web', count: 1 },
      { day: '2026-10-05', name: 'menu_generated', channel: 'web', count: 1 },
      { day: '2026-10-12', name: 'shopping_list_viewed', channel: null, count: 2 },
      { day: '2026-09-01', name: 'menu_generated', channel: 'web', count: 9 }, // outside the window
    ],
    householdDays: [hd('h1', '2026-10-05', 'mimo_message'), hd('h2', '2026-10-05', 'menu_generated'), hd('h1', '2026-10-12', 'shopping_list_viewed')],
  }

  it('daily: one row per day (zeros included), counts per event and channel, distinct households', () => {
    const daily = buildDaily(input)
    expect(daily).toHaveLength(9)
    expect(daily[0]).toEqual({
      day: '2026-10-05',
      activeHouseholds: 2,
      events: { mimo_message: 5, menu_generated: 1 },
      byChannel: { whatsapp: 4, web: 2 },
    })
    expect(daily[1]).toEqual({ day: '2026-10-06', activeHouseholds: 0, events: {}, byChannel: {} })
    expect(daily[7].byChannel).toEqual({ unknown: 2 })
  })

  it('weekly: ISO weeks on the Madrid calendar, the current one partial', () => {
    const weekly = buildWeekly(input)
    expect(weekly.map((w) => [w.isoWeek, w.partial, w.activeHouseholds])).toEqual([
      ['2026-W41', false, 2],
      ['2026-W42', true, 1],
    ])
    expect(weekly[0].events).toEqual({ mimo_message: 5, menu_generated: 1 })
  })

  it('totals: events, channels and distinct households per event', () => {
    const t = buildTotals(input)
    expect(t.activeHouseholds).toBe(2)
    expect(t.householdsByEvent).toEqual({ mimo_message: 1, menu_generated: 1, shopping_list_viewed: 1 })
    expect(t.events.menu_generated).toBe(10)
  })
})

describe('buildFunnel', () => {
  it('nests menu → list → cooked inside the first 7 days; week 2 is independent and only for eligible signups', () => {
    const input: UsageInput = {
      days: dayRange('2026-09-21', '2026-10-13'),
      today: '2026-10-13',
      counts: [],
      householdDays: [
        // h1: full path in week 1, back on day 8.
        hd('h1', '2026-09-28', 'signup_completed'),
        hd('h1', '2026-09-28', 'menu_generated'),
        hd('h1', '2026-09-29', 'shopping_list_viewed'),
        hd('h1', '2026-10-01', 'cook_mode_started'),
        hd('h1', '2026-10-06', 'mimo_message'),
        // h2: list without a menu → stops at signup; active on day 10.
        hd('h2', '2026-09-30', 'signup_completed'),
        hd('h2', '2026-09-30', 'shopping_list_viewed'),
        hd('h2', '2026-10-10', 'mimo_message'),
        // h3: menu on day 9 → too late for the first week.
        hd('h3', '2026-10-01', 'signup_completed'),
        hd('h3', '2026-10-10', 'menu_generated'),
        // h4: signed up 3 days ago — not eligible for week 2 yet.
        hd('h4', '2026-10-10', 'signup_completed'),
        hd('h4', '2026-10-10', 'menu_generated'),
        // No signup in the window: not in any cohort.
        hd('h5', '2026-10-01', 'menu_generated'),
      ],
    }
    expect(buildFunnel(input)).toEqual([
      { week: '2026-09-28', isoWeek: '2026-W40', signups: 3, firstMenu: 1, shoppingListViewed: 1, cooked: 1, week2Eligible: 3, activeWeek2: 3 },
      { week: '2026-10-05', isoWeek: '2026-W41', signups: 1, firstMenu: 1, shoppingListViewed: 0, cooked: 0, week2Eligible: 0, activeWeek2: 0 },
    ])
  })

  it('meal_cooked counts as cooked too', () => {
    const f = buildFunnel({
      days: dayRange('2026-10-01', '2026-10-13'),
      today: '2026-10-13',
      counts: [],
      householdDays: [
        hd('h1', '2026-10-05', 'signup_completed'),
        hd('h1', '2026-10-05', 'menu_generated'),
        hd('h1', '2026-10-05', 'shopping_list_viewed'),
        hd('h1', '2026-10-11', 'meal_cooked'),
      ],
    })
    expect(f[0].cooked).toBe(1)
    expect(f[0].activeWeek2).toBe(0)
  })
})

describe('PRO-106 — households: WhatsApp, avisos, members, channel split', () => {
  it('snapshot counts households, not people', () => {
    expect(
      buildHouseholdSnapshot([
        { householdId: 'h1', members: 2, whatsappLinked: 2, whatsappNotify: 1, pushEnabled: 0 },
        { householdId: 'h2', members: 1, whatsappLinked: 1, whatsappNotify: 0, pushEnabled: 1 },
        { householdId: 'h3', members: 3, whatsappLinked: 0, whatsappNotify: 0, pushEnabled: 2 },
        { householdId: 'h4', members: 1, whatsappLinked: 0, whatsappNotify: 0, pushEnabled: 0 },
      ]),
    ).toEqual({
      households: 4,
      withWhatsapp: 2,
      withWhatsappNotify: 1,
      withWhatsappDeclined: 0,
      withWhatsappNoAnswer: 1,
      withPush: 2,
      withNotices: 3,
      withTwoPlusMembers: 2,
    })
  })

  it('PRO-248: WhatsApp without avisos splits into «dijo que no» and «no contestó»', () => {
    const s = buildHouseholdSnapshot([
      { householdId: 'on', members: 1, whatsappLinked: 1, whatsappNotify: 1, whatsappDeclined: 0, pushEnabled: 0 },
      { householdId: 'no', members: 1, whatsappLinked: 1, whatsappNotify: 0, whatsappDeclined: 1, pushEnabled: 0 },
      { householdId: 'silent', members: 2, whatsappLinked: 2, whatsappNotify: 0, whatsappDeclined: 0, pushEnabled: 0 },
      { householdId: 'web', members: 1, whatsappLinked: 0, whatsappNotify: 0, whatsappDeclined: 0, pushEnabled: 0 },
    ])
    expect(s.withWhatsapp).toBe(3)
    expect(s.withWhatsappNotify).toBe(1)
    expect(s.withWhatsappDeclined).toBe(1)
    expect(s.withWhatsappNoAnswer).toBe(1)
    expect(s.withWhatsappNotify + s.withWhatsappDeclined + s.withWhatsappNoAnswer).toBe(s.withWhatsapp)
  })

  it('snapshot of nothing is zeros', () => {
    expect(buildHouseholdSnapshot([])).toEqual({ households: 0, withWhatsapp: 0, withWhatsappNotify: 0, withWhatsappDeclined: 0, withWhatsappNoAnswer: 0, withPush: 0, withNotices: 0, withTwoPlusMembers: 0 })
  })

  it('weekly split: web only / WhatsApp only / both; voice is the app; unknown-only apart', () => {
    const split = buildChannelSplit({
      days: dayRange('2026-10-05', '2026-10-18'),
      today: '2026-10-16',
      counts: [],
      householdDays: [
        { householdId: 'h1', day: '2026-10-05', name: 'menu_generated', channel: 'web' },
        { householdId: 'h1', day: '2026-10-07', name: 'mimo_message', channel: 'whatsapp' },
        { householdId: 'h2', day: '2026-10-06', name: 'mimo_message', channel: 'whatsapp' },
        { householdId: 'h3', day: '2026-10-06', name: 'mimo_message', channel: 'voice' },
        { householdId: 'h4', day: '2026-10-06', name: 'signup_completed', channel: null },
        { householdId: 'h4', day: '2026-10-06', name: 'menu_generated', channel: 'web' },
        { householdId: 'h5', day: '2026-10-08', name: 'signup_completed', channel: null },
        // next week: h1 only web
        { householdId: 'h1', day: '2026-10-13', name: 'shopping_list_viewed', channel: 'web' },
      ],
    })
    expect(split).toEqual([
      { week: '2026-10-05', isoWeek: '2026-W41', webOnly: 2, whatsappOnly: 1, both: 1, unknownOnly: 1 },
      { week: '2026-10-12', isoWeek: '2026-W42', webOnly: 1, whatsappOnly: 0, both: 0, unknownOnly: 0 },
    ])
  })
})
