/**
 * GET /admin/usage pure builders (specs/metrics.md "Usage events"): daily and
 * weekly counts, active households, and the activation funnel.
 */
import { describe, expect, it } from 'vitest'
import {
  SIGNUP_SOURCES_OPEN_DAYS,
  buildChannelSplit,
  buildDaily,
  buildFunnel,
  buildHouseholdSnapshot,
  buildSignupSources,
  buildTotals,
  buildWeekly,
  dayRange,
  type UsageInput,
  week2Monday,
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

describe('buildSignupSources (PRO-1288)', () => {
  it('counts signups by week, closed ?ref label and utm_source, each with its first menu', () => {
    const input: UsageInput = {
      days: dayRange('2026-11-16', '2026-11-29'),
      today: '2026-11-29',
      counts: [],
      householdDays: [
        hd('h1', '2026-11-23', 'signup_completed'),
        hd('h1', '2026-11-24', 'menu_generated'),
        hd('h2', '2026-11-23', 'signup_completed'),
        hd('h3', '2026-11-25', 'signup_completed'),
        hd('h3', '2026-11-25', 'menu_generated'),
        // h4: menu on day 8 → no first menu.
        hd('h4', '2026-11-17', 'signup_completed'),
        hd('h4', '2026-11-25', 'menu_generated'),
      ],
    }
    const known = new Set(['directo', 'receta', 'iar-receta'])
    const rows = buildSignupSources(
      input,
      [
        { householdId: 'h1', day: '2026-11-23', source: 'iar-receta', utmSource: 'Instagram' },
        { householdId: 'h2', day: '2026-11-23', source: 'Juan García', utmSource: null },
        { householdId: 'h3', day: '2026-11-25', source: null, utmSource: null },
        { householdId: 'h4', day: '2026-11-17', source: '', utmSource: 'boletin-raro' },
      ],
      known,
    )
    expect(rows).toEqual([
      { week: '2026-11-16', isoWeek: '2026-W47', source: 'directo', utmSource: 'otro', signups: 1, firstMenu: 0, firstHit: 0, week2MenuReady: 0, twoPlusPeople: 0, partial: true },
      { week: '2026-11-23', isoWeek: '2026-W48', source: 'directo', utmSource: 'ninguna', signups: 1, firstMenu: 1, firstHit: 0, week2MenuReady: 0, twoPlusPeople: 0, partial: true },
      { week: '2026-11-23', isoWeek: '2026-W48', source: 'iar-receta', utmSource: 'instagram', signups: 1, firstMenu: 1, firstHit: 0, week2MenuReady: 0, twoPlusPeople: 0, partial: true },
      { week: '2026-11-23', isoWeek: '2026-W48', source: 'otro', utmSource: 'ninguna', signups: 1, firstMenu: 0, firstHit: 0, week2MenuReady: 0, twoPlusPeople: 0, partial: true },
    ])
    expect(JSON.stringify(rows)).not.toMatch(/h[1-4]|Juan/)
  })

  it('a household with two signups counts once, with the first one', () => {
    const input: UsageInput = { days: dayRange('2026-11-23', '2026-11-29'), today: '2026-11-29', counts: [], householdDays: [] }
    const rows = buildSignupSources(
      input,
      [
        { householdId: 'h1', day: '2026-11-26', source: null, utmSource: null },
        { householdId: 'h1', day: '2026-11-24', source: 'receta', utmSource: 'wa' },
      ],
      new Set(['directo', 'receta']),
    )
    expect(rows).toEqual([{ week: '2026-11-23', isoWeek: '2026-W48', source: 'receta', utmSource: 'whatsapp', signups: 1, firstMenu: 0, firstHit: 0, week2MenuReady: 0, twoPlusPeople: 0, partial: true }])
  })
})

describe('signupSources: first hit, week 2 and 2 people or more (PRO-1310)', () => {
  // Signed up on Tuesday 10-nov and Wednesday 11-nov (W46): both windows (day 7 and day 14) are over on Sunday 29-nov.
  const input: UsageInput = {
    days: dayRange('2026-11-02', '2026-11-29'),
    today: '2026-11-29',
    counts: [],
    householdDays: [
      // h1: iar-receta by Instagram — cooks and ticks the list in its first week.
      hd('h1', '2026-11-10', 'signup_completed'),
      hd('h1', '2026-11-10', 'menu_generated'),
      hd('h1', '2026-11-11', 'shopping_item_checked'),
      hd('h1', '2026-11-12', 'meal_cooked'),
      // h2: iar-receta by Facebook — only cooks, no list; the list on day 7 is too late.
      hd('h2', '2026-11-10', 'signup_completed'),
      hd('h2', '2026-11-11', 'cook_mode_started'),
      hd('h2', '2026-11-17', 'shopping_list_shared'),
      // h3: no label, 2 people — list and cooking, but the cooking on day 7.
      hd('h3', '2026-11-11', 'signup_completed'),
      hd('h3', '2026-11-12', 'carrefour_click'),
      hd('h3', '2026-11-18', 'meal_cooked'),
      // h4: iar-receta by Instagram this week (W48): its windows are still open.
      hd('h4', '2026-11-24', 'signup_completed'),
      hd('h4', '2026-11-24', 'meal_cooked'),
      hd('h4', '2026-11-24', 'basket_extension_sent'),
    ],
  }
  const signups = [
    { householdId: 'h1', day: '2026-11-10', source: 'iar-receta', utmSource: 'Instagram' },
    { householdId: 'h2', day: '2026-11-10', source: 'iar-receta', utmSource: 'fb' },
    { householdId: 'h3', day: '2026-11-11', source: null, utmSource: null },
    { householdId: 'h4', day: '2026-11-24', source: 'iar-receta', utmSource: 'ig' },
  ]
  const outcomes = {
    menus: [
      // h1: week 2 (Monday 23-nov, day 13) made on Friday 20-nov → ready.
      { householdId: 'h1', week: '2026-11-23', firstCreatedAt: '2026-11-20T10:00:00.000Z', autoplanSeenAt: null },
      // h2: the Monday on day 6 is week 1, not week 2; week 2 made on that Monday at noon → not ready.
      { householdId: 'h2', week: '2026-11-16', firstCreatedAt: '2026-11-14T10:00:00.000Z', autoplanSeenAt: null },
      { householdId: 'h2', week: '2026-11-23', firstCreatedAt: '2026-11-23T11:00:00.000Z', autoplanSeenAt: null },
      // h3: week 2 (Monday 23-nov, day 12) by the Thursday autopilot, never seen → not ready.
      { householdId: 'h3', week: '2026-11-23', firstCreatedAt: null, autoplanSeenAt: null },
    ],
    people: [
      { householdId: 'h1', people: 1, accounts: 1 },
      { householdId: 'h2', people: 0, accounts: 1 },
      { householdId: 'h3', people: 2, accounts: 1 },
      { householdId: 'h4', people: 1, accounts: 2 },
    ],
  }
  const known = new Set(['directo', 'iar-receta'])

  it('per row: firstHit, week2MenuReady, twoPlusPeople and partial; Instagram apart from Facebook', () => {
    const rows = buildSignupSources(input, signups, known, outcomes)
    expect(rows).toEqual([
      { week: '2026-11-09', isoWeek: '2026-W46', source: 'directo', utmSource: 'ninguna', signups: 1, firstMenu: 0, firstHit: 0, week2MenuReady: 0, twoPlusPeople: 1, partial: false },
      { week: '2026-11-09', isoWeek: '2026-W46', source: 'iar-receta', utmSource: 'facebook', signups: 1, firstMenu: 0, firstHit: 0, week2MenuReady: 0, twoPlusPeople: 0, partial: false },
      { week: '2026-11-09', isoWeek: '2026-W46', source: 'iar-receta', utmSource: 'instagram', signups: 1, firstMenu: 1, firstHit: 1, week2MenuReady: 1, twoPlusPeople: 0, partial: false },
      { week: '2026-11-23', isoWeek: '2026-W48', source: 'iar-receta', utmSource: 'instagram', signups: 1, firstMenu: 0, firstHit: 1, week2MenuReady: 0, twoPlusPeople: 1, partial: true },
    ])
    expect(JSON.stringify(rows)).not.toMatch(/h[1-4]|2026-11-1[0-9]T|fb|ig"/)
  })

  it('partial until day 14 of the last household; without outcomes, week 2 and people are 0', () => {
    const one = (today: string) => buildSignupSources({ ...input, today }, [signups[0]], known)[0]
    expect(one('2026-11-23')).toMatchObject({ firstHit: 1, week2MenuReady: 0, twoPlusPeople: 0, partial: true })
    expect(one('2026-11-24')).toMatchObject({ partial: false })
    expect(SIGNUP_SOURCES_OPEN_DAYS).toBe(14)
  })

  it('week2Monday: the Monday on days 7–13 from signup', () => {
    expect(week2Monday('2026-11-09')).toBe('2026-11-16') // Monday → day 7
    expect(week2Monday('2026-11-10')).toBe('2026-11-23') // Tuesday → day 13
    expect(week2Monday('2026-11-15')).toBe('2026-11-23') // Sunday → day 8
  })
})
