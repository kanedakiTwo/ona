/**
 * Pure-logic tests for GET /admin/metrics: Europe/Madrid ISO-week bucketing,
 * the "resolved week" rule (menu for the week + shopping-list use that week or
 * the weekend before), cost roll-ups and signup cohorts. The SQL loader only
 * returns distinct (household, week|day) pairs and cost sums; every rule the
 * Dirección/Finance agents read lives here.
 */
import { describe, expect, it } from 'vitest'
import {
  isoWeekLabel,
  lastWeekStarts,
  shoppingWeeksFor,
  weekOfDay,
  buildWeekly,
  buildCohorts,
  buildTotals,
  type MetricsInput,
} from '../services/businessMetrics.js'

describe('lastWeekStarts (Europe/Madrid)', () => {
  it('returns the last n Mondays, oldest first, ending with the current week', () => {
    // 2026-10-07 is a Wednesday.
    expect(lastWeekStarts(new Date('2026-10-07T10:00:00Z'), 3)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05'])
  })

  it('uses the Madrid wall clock: Sunday 22:30 UTC is already Monday in Madrid', () => {
    // 2026-10-04 is a Sunday; 22:30 UTC = Monday 00:30 CEST.
    expect(lastWeekStarts(new Date('2026-10-04T22:30:00Z'), 1)).toEqual(['2026-10-05'])
    // …and 21:30 UTC is still Sunday 23:30 in Madrid.
    expect(lastWeekStarts(new Date('2026-10-04T21:30:00Z'), 1)).toEqual(['2026-09-28'])
  })
})

describe('weekOfDay / isoWeekLabel', () => {
  it('maps any calendar day to the Monday of its ISO week', () => {
    expect(weekOfDay('2026-10-05')).toBe('2026-10-05') // Monday
    expect(weekOfDay('2026-10-11')).toBe('2026-10-05') // Sunday
    expect(weekOfDay('2026-10-12')).toBe('2026-10-12')
  })

  it('labels weeks with the ISO year (not the calendar year) at year edges', () => {
    expect(isoWeekLabel('2026-10-05')).toBe('2026-W41')
    expect(isoWeekLabel('2025-12-29')).toBe('2026-W01') // Jan 1 2026 is a Thursday
    expect(isoWeekLabel('2026-12-28')).toBe('2026-W53') // 2026 has 53 ISO weeks
    expect(isoWeekLabel('2027-01-04')).toBe('2027-W01')
    expect(isoWeekLabel('2024-12-30')).toBe('2025-W01')
  })
})

describe('shoppingWeeksFor', () => {
  it('a weekday interaction counts for its own week only', () => {
    expect(shoppingWeeksFor('2026-10-07')).toEqual(['2026-10-05']) // Wednesday
    expect(shoppingWeeksFor('2026-10-09')).toEqual(['2026-10-05']) // Friday
  })

  it('a weekend interaction also counts for the coming week (Saturday shop for next week)', () => {
    expect(shoppingWeeksFor('2026-10-10')).toEqual(['2026-10-05', '2026-10-12']) // Saturday
    expect(shoppingWeeksFor('2026-10-11')).toEqual(['2026-10-05', '2026-10-12']) // Sunday
  })
})

const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05']

function input(over: Partial<MetricsInput> = {}): MetricsInput {
  return {
    weeks: WEEKS,
    currentWeek: '2026-10-05',
    activity: [],
    menus: [],
    shoppingDays: [],
    signups: [],
    costs: [],
    ...over,
  }
}

describe('buildWeekly', () => {
  it('counts distinct active households per week', () => {
    const weekly = buildWeekly(
      input({
        activity: [
          { householdId: 'h1', week: '2026-09-21' },
          { householdId: 'h2', week: '2026-09-21' },
          { householdId: 'h1', week: '2026-09-21' }, // duplicate pair
          { householdId: 'h1', week: '2026-10-05' },
        ],
      }),
    )
    expect(weekly.map((w) => w.activeHouseholds)).toEqual([2, 0, 1])
    expect(weekly.map((w) => w.isoWeek)).toEqual(['2026-W39', '2026-W40', '2026-W41'])
    expect(weekly.map((w) => w.partial)).toEqual([false, false, true])
  })

  it('resolved = menu for the week AND shopping use that week or the weekend before', () => {
    const weekly = buildWeekly(
      input({
        menus: [
          { householdId: 'h1', week: '2026-09-28' },
          { householdId: 'h2', week: '2026-09-28' },
          { householdId: 'h3', week: '2026-09-28' },
        ],
        shoppingDays: [
          { householdId: 'h1', day: '2026-09-27' }, // Sunday before → counts for 09-28
          { householdId: 'h2', day: '2026-09-30' }, // Wednesday of that week
          { householdId: 'h3', day: '2026-09-24' }, // Thursday before → does NOT count
          { householdId: 'h4', day: '2026-09-30' }, // shopped but no menu
        ],
      }),
    )
    expect(weekly.map((w) => w.resolvedWeekHouseholds)).toEqual([0, 2, 0])
  })

  it('counts new households by the Madrid signup week', () => {
    const weekly = buildWeekly(
      input({
        signups: [
          { householdId: 'h1', day: '2026-09-27' }, // Sunday → week 09-21
          { householdId: 'h2', day: '2026-09-28' },
          { householdId: 'h3', day: '2026-10-06' },
        ],
      }),
    )
    expect(weekly.map((w) => w.newHouseholds)).toEqual([1, 1, 1])
  })

  it('sums cost in EUR by provider and feature, keeps internal accounts apart, divides by active households', () => {
    const weekly = buildWeekly(
      input({
        activity: [
          { householdId: 'h1', week: '2026-10-05' },
          { householdId: 'h2', week: '2026-10-05' },
        ],
        costs: [
          { week: '2026-10-05', provider: 'anthropic', feature: 'assistant_chat', micros: 30_000, events: 3, unpriced: 0, internal: false },
          { week: '2026-10-05', provider: 'openai', feature: 'voice_realtime', micros: 10_000, events: 1, unpriced: 0, internal: false },
          { week: '2026-10-05', provider: 'anthropic', feature: 'assistant_chat', micros: 500_000, events: 9, unpriced: 0, internal: true },
        ],
      }),
    )
    const w = weekly[2]
    expect(w.costEur.total).toBeCloseTo(0.04, 6)
    expect(w.costEur.byProvider).toEqual({ anthropic: 0.03, openai: 0.01 })
    expect(w.costEur.byFeature).toEqual({ assistant_chat: 0.03, voice_realtime: 0.01 })
    expect(w.internalCostEur).toBeCloseTo(0.5, 6)
    expect(w.costPerActiveHouseholdEur).toBeCloseTo(0.02, 6)
  })

  it('cost per active household is null (not Infinity) in a week with no activity', () => {
    const weekly = buildWeekly(
      input({ costs: [{ week: '2026-09-21', provider: 'anthropic', feature: 'whatsapp_review', micros: 1000, events: 1, unpriced: 0, internal: false }] }),
    )
    expect(weekly[0].costEur.total).toBeCloseTo(0.001, 6)
    expect(weekly[0].costPerActiveHouseholdEur).toBeNull()
  })

  it('ignores pairs outside the requested window', () => {
    const weekly = buildWeekly(input({ activity: [{ householdId: 'h1', week: '2026-09-14' }] }))
    expect(weekly.map((w) => w.activeHouseholds)).toEqual([0, 0, 0])
  })
})

describe('buildCohorts', () => {
  it('retention Wk = share of the signup cohort active k weeks later; future weeks are null', () => {
    const cohorts = buildCohorts(
      input({
        signups: [
          { householdId: 'h1', day: '2026-09-22' },
          { householdId: 'h2', day: '2026-09-23' },
          { householdId: 'h3', day: '2026-10-05' },
        ],
        activity: [
          { householdId: 'h1', week: '2026-09-28' }, // h1 back in W1
          { householdId: 'h1', week: '2026-10-05' }, // and W2
          { householdId: 'h2', week: '2026-10-05' }, // h2 only in W2
          { householdId: 'h3', week: '2026-10-05' }, // activity in its own signup week doesn't count as retention
        ],
      }),
    )
    expect(cohorts).toEqual([
      { week: '2026-09-21', isoWeek: '2026-W39', size: 2, retention: { w1: 0.5, w2: 1, w3: null, w4: null } },
      { week: '2026-10-05', isoWeek: '2026-W41', size: 1, retention: { w1: null, w2: null, w3: null, w4: null } },
    ])
  })

  it('skips weeks with no signups', () => {
    const cohorts = buildCohorts(input({ signups: [{ householdId: 'h1', day: '2026-09-29' }] }))
    expect(cohorts.map((c) => c.week)).toEqual(['2026-09-28'])
  })
})

describe('buildTotals', () => {
  it('rolls the window up: distinct active households, household-weeks, cost per active household-week', () => {
    const inp = input({
      activity: [
        { householdId: 'h1', week: '2026-09-21' },
        { householdId: 'h1', week: '2026-09-28' },
        { householdId: 'h2', week: '2026-09-28' },
        { householdId: 'h1', week: '2026-10-05' },
      ],
      signups: [{ householdId: 'h2', day: '2026-09-29' }],
      costs: [
        { week: '2026-09-21', provider: 'anthropic', feature: 'assistant_chat', micros: 100_000, events: 1, unpriced: 0, internal: false },
        { week: '2026-10-05', provider: 'meta_whatsapp', feature: 'whatsapp_template', micros: 300_000, events: 1, unpriced: 1, internal: false },
      ],
    })
    const totals = buildTotals(inp, buildWeekly(inp))
    expect(totals.activeHouseholds).toBe(2)
    expect(totals.activeHouseholdWeeks).toBe(4)
    expect(totals.newHouseholds).toBe(1)
    expect(totals.costEur.total).toBeCloseTo(0.4, 6)
    expect(totals.costEur.byProvider).toEqual({ anthropic: 0.1, meta_whatsapp: 0.3 })
    expect(totals.costPerActiveHouseholdWeekEur).toBeCloseTo(0.1, 6)
    expect(totals.unpricedCostEvents).toBe(1)
  })
})
