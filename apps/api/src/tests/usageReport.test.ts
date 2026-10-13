/**
 * GET /admin/usage pure builders (specs/metrics.md "Usage events"): daily and
 * weekly counts, active households, and the activation funnel.
 */
import { describe, expect, it } from 'vitest'
import { buildDaily, buildFunnel, buildTotals, buildWeekly, dayRange, type UsageInput } from '../services/usageReport.js'

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
