/**
 * PRO-65: a sign-up on Sunday got a first menu for the week that ends that
 * same day. Friday to Sunday (Madrid time) onboarding now generates the
 * current week AND the next one, and /menu opens the next.
 */
import { describe, expect, it } from 'vitest'
import { firstMenuWeeks, pastDayIndexes } from '@ona/shared'

describe('firstMenuWeeks', () => {
  it('Monday to Thursday: only the current week, opened', () => {
    // Thursday 2026-10-15 20:00 Madrid (18:00 UTC)
    expect(firstMenuWeeks(new Date('2026-10-15T18:00:00Z'))).toMatchObject({
      weeks: ['2026-10-12'],
      open: '2026-10-12',
    })
    // Monday 2026-10-12 08:00 Madrid
    expect(firstMenuWeeks(new Date('2026-10-12T06:00:00Z'))).toMatchObject({
      weeks: ['2026-10-12'],
      open: '2026-10-12',
    })
  })

  it('Friday, Saturday and Sunday: current and next week, opens the next', () => {
    const both = { weeks: ['2026-10-05', '2026-10-12'], open: '2026-10-12' }
    expect(firstMenuWeeks(new Date('2026-10-09T10:00:00Z'))).toMatchObject(both) // viernes 9
    expect(firstMenuWeeks(new Date('2026-10-10T10:00:00Z'))).toMatchObject(both) // sábado 10
    expect(firstMenuWeeks(new Date('2026-10-11T21:30:00Z'))).toMatchObject(both) // domingo 11, 23:30 Madrid
  })

  it('uses the Madrid wall clock, not UTC', () => {
    // Thursday 23:30 UTC = Friday 01:30 Madrid → already the weekend rule.
    expect(firstMenuWeeks(new Date('2026-10-08T23:30:00Z'))).toMatchObject({
      weeks: ['2026-10-05', '2026-10-12'],
      open: '2026-10-12',
    })
    // Sunday 22:30 UTC = Monday 00:30 Madrid → a new week, only that one.
    expect(firstMenuWeeks(new Date('2026-10-11T22:30:00Z'))).toMatchObject({
      weeks: ['2026-10-12'],
      open: '2026-10-12',
    })
  })

  it('crosses month and year boundaries', () => {
    // Saturday 2027-01-02 → week of Monday 2026-12-28, next 2027-01-04.
    expect(firstMenuWeeks(new Date('2027-01-02T12:00:00Z'))).toMatchObject({
      weeks: ['2026-12-28', '2027-01-04'],
      open: '2027-01-04',
    })
  })
})

describe('the first menu starts on the sign-up day (PRO-244)', () => {
  it('a Wednesday sign-up: only this week, from Wednesday on', () => {
    // Wednesday 2026-10-14 18:00 Madrid
    const plan = firstMenuWeeks(new Date('2026-10-14T16:00:00Z'))
    expect(plan).toEqual({ weeks: ['2026-10-12'], open: '2026-10-12', today: '2026-10-14' })
    expect(pastDayIndexes(plan.weeks[0], plan.today)).toEqual([0, 1])
  })

  it('a Saturday sign-up (the WhatsApp case of 17-oct): Saturday and Sunday, plus next week whole', () => {
    // Saturday 2026-10-17 11:00 Madrid
    const plan = firstMenuWeeks(new Date('2026-10-17T09:00:00Z'))
    expect(plan).toEqual({ weeks: ['2026-10-12', '2026-10-19'], open: '2026-10-19', today: '2026-10-17' })
    expect(pastDayIndexes('2026-10-12', plan.today)).toEqual([0, 1, 2, 3, 4])
    expect(pastDayIndexes('2026-10-19', plan.today)).toEqual([])
  })

  it('a Monday sign-up loses nothing; a Sunday one keeps only Sunday', () => {
    expect(pastDayIndexes('2026-10-12', '2026-10-12')).toEqual([])
    expect(pastDayIndexes('2026-10-12', '2026-10-18')).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('crosses month boundaries', () => {
    // Week of Monday 2026-09-28, sign-up Thursday 1 October
    expect(pastDayIndexes('2026-09-28', '2026-10-01')).toEqual([0, 1, 2])
  })
})

describe('generationSkips — POST /menu/generate with fromDate (PRO-244)', async () => {
  const { generationSkips } = await import('../services/menuWeek.js')
  it('adds the days before fromDate to the "sin cocinar" ones, only for generation', () => {
    const own = new Set([5])
    expect([...generationSkips(own, '2026-10-12', '2026-10-14')].sort()).toEqual([0, 1, 5])
    expect(own).toEqual(new Set([5])) // the stored list is not touched
  })
  it('without fromDate, or for a week that starts later, nothing changes', () => {
    expect([...generationSkips(new Set([2]), '2026-10-12')]).toEqual([2])
    expect([...generationSkips(new Set(), '2026-10-19', '2026-10-17')]).toEqual([])
  })
})
