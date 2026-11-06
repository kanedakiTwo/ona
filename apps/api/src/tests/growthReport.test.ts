/**
 * PRO-379 (D-158, specs/metrics.md): the growth line in GET /admin/usage —
 * first hit, two weeks in a row and paying by signup cohort, the trial today
 * and time to the first menu. Pure builders with made-up households, one per case.
 */
import { describe, expect, it } from 'vitest'
import {
  buildGrowth,
  buildTimeToFirstMenu,
  buildTrialReport,
  GROWTH_DEFINITIONS,
  hasTwoWeeksInARow,
  medianAndP90,
  type GrowthEvent,
  type GrowthInput,
  type GrowthMenuWeek,
} from '../services/growthReport.js'
import { USAGE_DEFINITIONS } from '../services/usageReport.js'

// Madrid is UTC+2 until 2026-10-25 and UTC+1 after: these instants stay on the same Madrid day.
const ev = (householdId: string, name: string, day: string, time = '10:00:00'): GrowthEvent => ({ householdId, name, day, at: `${day}T${time}Z` })
const menu = (householdId: string, week: string, firstCreatedAt: string): GrowthMenuWeek => ({ householdId, week, firstCreatedAt })
const input = (over: Partial<GrowthInput>): GrowthInput => ({ now: new Date('2026-11-04T11:00:00Z'), signups: [], events: [], menus: [], subscriptions: [], ...over })

describe('buildGrowth: first hit', () => {
  // Signup Monday 2026-10-05; today 2026-11-04 → every window is over.
  const signups = [
    { householdId: 'hit', at: '2026-10-05T09:00:00Z' },
    { householdId: 'cookOnly', at: '2026-10-05T09:00:00Z' },
    { householdId: 'late', at: '2026-10-05T09:00:00Z' },
    { householdId: 'shop', at: '2026-10-05T09:00:00Z' },
  ]
  const events = [
    ev('hit', 'menu_generated', '2026-10-05'),
    ev('hit', 'meal_cooked', '2026-10-07'),
    ev('hit', 'shopping_item_checked', '2026-10-06'),
    // Cooked but never used or sent the list.
    ev('cookOnly', 'menu_generated', '2026-10-05'),
    ev('cookOnly', 'cook_mode_started', '2026-10-06'),
    // Both, but the list on day 7 (outside days 0–6).
    ev('late', 'cook_mode_started', '2026-10-06'),
    ev('late', 'shopping_list_shared', '2026-10-12'),
    // Cook mode plus an order sent to the shop.
    ev('shop', 'cook_mode_started', '2026-10-11'),
    ev('shop', 'basket_extension_sent', '2026-10-08'),
  ]
  const [c] = buildGrowth(input({ signups, events }))

  it('counts the cohort by signup week', () => {
    expect(c.week).toBe('2026-10-05')
    expect(c.isoWeek).toBe('2026-W41')
    expect(c.signups).toBe(4)
  })

  it('first hit = cooked and used or sent the list, both on days 0–6', () => {
    expect(c.firstHit).toEqual({ eligible: 4, reached: 2, reachedInOpenWindow: 0 })
  })

  it('first menu is not nested: each step counts on its own', () => {
    expect(c.firstMenu).toEqual({ eligible: 4, reached: 2, reachedInOpenWindow: 0 })
  })
})

describe('buildGrowth: windows not over yet', () => {
  // Signup on 2026-11-02 (Monday): day 2 today.
  const signups = [{ householdId: 'new', at: '2026-11-02T09:00:00Z' }]
  const events = [ev('new', 'menu_generated', '2026-11-02'), ev('new', 'meal_cooked', '2026-11-03'), ev('new', 'shopping_item_checked', '2026-11-03')]
  const [c] = buildGrowth(input({ signups, events }))

  it('what already happened goes to reachedInOpenWindow, not to reached', () => {
    expect(c.firstMenu).toEqual({ eligible: 0, reached: 0, reachedInOpenWindow: 1 })
    expect(c.firstHit).toEqual({ eligible: 0, reached: 0, reachedInOpenWindow: 1 })
    expect(c.twoWeeks).toEqual({ eligible: 0, reached: 0, reachedInOpenWindow: 0 })
  })

  it('day 7 closes the first week: eligible from then on', () => {
    const [d7] = buildGrowth(input({ signups, events, now: new Date('2026-11-09T11:00:00Z') }))
    expect(d7.firstHit).toEqual({ eligible: 1, reached: 1, reachedInOpenWindow: 0 })
    expect(d7.twoWeeks.eligible).toBe(0)
  })
})

describe('two weeks in a row', () => {
  // Signup Wednesday 2026-10-07 (day 0). Mondays on days 0–20: 10-12 (day 5), 10-19 (day 12), 10-26 (day 19).
  const day0 = '2026-10-07'
  // Sunday 20:00 Madrid = 19:00Z, before Monday 00:00.
  const ready = (week: string, sunday: string) => menu('h', week, `${sunday}T19:00:00Z`)

  it('two consecutive weeks, both ready before their Monday → yes', () => {
    expect(hasTwoWeeksInARow(day0, [ready('2026-10-12', '2026-10-11'), ready('2026-10-19', '2026-10-18')])).toBe(true)
  })

  it('with a gap (weeks 1 and 3) → no', () => {
    expect(hasTwoWeeksInARow(day0, [ready('2026-10-12', '2026-10-11'), ready('2026-10-26', '2026-10-25')])).toBe(false)
  })

  it('one of the two made on Monday itself (01:30 Madrid) → no', () => {
    expect(hasTwoWeeksInARow(day0, [ready('2026-10-12', '2026-10-11'), menu('h', '2026-10-19', '2026-10-18T23:30:00Z')])).toBe(false)
  })

  it('the second Monday after day 20 → no', () => {
    // Weeks of 10-26 (day 19) and 11-02 (day 26).
    expect(hasTwoWeeksInARow(day0, [ready('2026-10-26', '2026-10-25'), ready('2026-11-02', '2026-11-01')])).toBe(false)
  })

  it('in the cohort: eligible from day 21, the open window apart', () => {
    const signups = [
      { householdId: 'two', at: `${day0}T09:00:00Z` },
      { householdId: 'gap', at: `${day0}T09:00:00Z` },
      { householdId: 'fresh', at: '2026-10-21T09:00:00Z' },
    ]
    const menus = [
      menu('two', '2026-10-12', '2026-10-11T19:00:00Z'),
      menu('two', '2026-10-19', '2026-10-18T19:00:00Z'),
      menu('gap', '2026-10-12', '2026-10-11T19:00:00Z'),
      menu('gap', '2026-10-26', '2026-10-25T19:00:00Z'),
      // Signed up 2026-10-21 (day 14 today), already two weeks in a row.
      menu('fresh', '2026-10-26', '2026-10-25T19:00:00Z'),
      menu('fresh', '2026-11-02', '2026-11-01T19:00:00Z'),
    ]
    const cohorts = buildGrowth(input({ signups, menus }))
    expect(cohorts.map((c) => [c.week, c.twoWeeks])).toEqual([
      ['2026-10-05', { eligible: 2, reached: 1, reachedInOpenWindow: 0 }],
      ['2026-10-19', { eligible: 0, reached: 0, reachedInOpenWindow: 1 }],
    ])
  })
})

describe('buildGrowth: paid', () => {
  it('active or trialing (card left) today; past_due, canceled or none are not', () => {
    const signups = ['active', 'trialing', 'pastDue', 'canceled', 'none'].map((householdId) => ({ householdId, at: '2026-10-05T09:00:00Z' }))
    const subscriptions = [
      { householdId: 'active', status: 'active' },
      { householdId: 'trialing', status: 'trialing' },
      { householdId: 'pastDue', status: 'past_due' },
      { householdId: 'canceled', status: 'canceled' },
    ]
    const [c] = buildGrowth(input({ signups, subscriptions }))
    expect(c.paid).toEqual({ eligible: 5, reached: 2, reachedInOpenWindow: 0 })
  })

  it('a household that signed up twice counts once, in the week of the first', () => {
    const signups = [
      { householdId: 'h', at: '2026-10-12T09:00:00Z' },
      { householdId: 'h', at: '2026-10-05T09:00:00Z' },
    ]
    expect(buildGrowth(input({ signups })).map((c) => [c.week, c.signups])).toEqual([['2026-10-05', 1]])
  })
})

describe('timeToFirstMenu', () => {
  it('median and p90 in minutes from signup to the first menu after it, by cohort', () => {
    const signups = ['a', 'b', 'c', 'none'].map((householdId) => ({ householdId, at: '2026-10-05T09:00:00Z' }))
    const events = [
      ev('a', 'menu_generated', '2026-10-05', '09:10:00'), // 10 min
      ev('a', 'menu_generated', '2026-10-06', '09:00:00'), // a later one does not count
      ev('b', 'menu_generated', '2026-10-05', '09:30:00'), // 30 min
      ev('c', 'menu_generated', '2026-10-06', '09:00:00'), // 1 440 min
      ev('none', 'meal_cooked', '2026-10-05'),
    ]
    expect(buildTimeToFirstMenu({ signups, events })).toEqual([
      { week: '2026-10-05', isoWeek: '2026-W41', signups: 4, withMenu: 3, medianMinutes: 30, p90Minutes: 1440 },
    ])
  })

  it('medianAndP90: even counts average the middle; nothing → null', () => {
    expect(medianAndP90([4, 1, 3, 2])).toEqual({ median: 3, p90: 4 })
    expect(medianAndP90([])).toEqual({ median: null, p90: null })
  })
})

describe('buildTrialReport', () => {
  const row = (householdId: string, latestStatus: string | null, extra: Partial<{ createdAt: string; cancelAtPeriodEnd: boolean; trialDays: number }> = {}) => ({
    householdId,
    createdAt: extra.createdAt ?? '2026-12-20T10:00:00Z',
    trialDays: extra.trialDays ?? 14,
    latestStatus,
    cancelAtPeriodEnd: extra.cancelAtPeriodEnd ?? false,
  })

  it('before launch day everyone without a plan is in the beta', () => {
    const r = buildTrialReport([row('a', null), row('b', 'trialing'), row('c', 'canceled')], new Date('2026-11-04T11:00:00Z'))
    expect(r).toMatchObject({ beta: 2, inTrial: 0, withCard: 1, paused: 0 })
    expect(r.cancellations).toEqual({ total: 1, byReason: { unknown: 1 } })
  })

  it('after launch: trial, card, paying, paused, scheduled cancel and past_due', () => {
    const now = new Date('2027-01-10T11:00:00Z')
    const r = buildTrialReport(
      [
        row('trial', null, { createdAt: '2027-01-05T10:00:00Z' }),
        row('creator', null, { createdAt: '2026-12-20T10:00:00Z', trialDays: 28 }), // 28 days: still in it
        row('over', null, { createdAt: '2026-12-20T10:00:00Z' }), // 14 days ended on 2027-01-03
        row('card', 'trialing', { cancelAtPeriodEnd: true }),
        row('paying', 'active'),
        row('late', 'past_due'),
        row('gone', 'canceled', { createdAt: '2026-12-20T10:00:00Z' }),
      ],
      now,
    )
    expect(r).toEqual({
      beta: 0,
      inTrial: 2,
      withCard: 1,
      paying: 1,
      paused: 2,
      free: 0,
      cancelScheduled: 1,
      pastDue: 1,
      cancellations: { total: 1, byReason: { unknown: 1 } },
    })
  })
})

describe('definitions', () => {
  it('growth, trial and timeToFirstMenu are explained in /admin/usage', () => {
    for (const k of Object.keys(GROWTH_DEFINITIONS)) expect(USAGE_DEFINITIONS).toHaveProperty(k)
    expect(USAGE_DEFINITIONS.growth).toMatch(/menuReadyByMondayHouseholds/)
  })
})
