/**
 * PRO-65: a sign-up on Sunday got a first menu for the week that ends that
 * same day. Friday to Sunday (Madrid time) onboarding now generates the
 * current week AND the next one, and /menu opens the next.
 */
import { describe, expect, it } from 'vitest'
import { firstMenuWeeks } from '@ona/shared'

describe('firstMenuWeeks', () => {
  it('Monday to Thursday: only the current week, opened', () => {
    // Thursday 2026-10-15 20:00 Madrid (18:00 UTC)
    expect(firstMenuWeeks(new Date('2026-10-15T18:00:00Z'))).toEqual({
      weeks: ['2026-10-12'],
      open: '2026-10-12',
    })
    // Monday 2026-10-12 08:00 Madrid
    expect(firstMenuWeeks(new Date('2026-10-12T06:00:00Z'))).toEqual({
      weeks: ['2026-10-12'],
      open: '2026-10-12',
    })
  })

  it('Friday, Saturday and Sunday: current and next week, opens the next', () => {
    const both = { weeks: ['2026-10-05', '2026-10-12'], open: '2026-10-12' }
    expect(firstMenuWeeks(new Date('2026-10-09T10:00:00Z'))).toEqual(both) // viernes 9
    expect(firstMenuWeeks(new Date('2026-10-10T10:00:00Z'))).toEqual(both) // sábado 10
    expect(firstMenuWeeks(new Date('2026-10-11T21:30:00Z'))).toEqual(both) // domingo 11, 23:30 Madrid
  })

  it('uses the Madrid wall clock, not UTC', () => {
    // Thursday 23:30 UTC = Friday 01:30 Madrid → already the weekend rule.
    expect(firstMenuWeeks(new Date('2026-10-08T23:30:00Z'))).toEqual({
      weeks: ['2026-10-05', '2026-10-12'],
      open: '2026-10-12',
    })
    // Sunday 22:30 UTC = Monday 00:30 Madrid → a new week, only that one.
    expect(firstMenuWeeks(new Date('2026-10-11T22:30:00Z'))).toEqual({
      weeks: ['2026-10-12'],
      open: '2026-10-12',
    })
  })

  it('crosses month and year boundaries', () => {
    // Saturday 2027-01-02 → week of Monday 2026-12-28, next 2027-01-04.
    expect(firstMenuWeeks(new Date('2027-01-02T12:00:00Z'))).toEqual({
      weeks: ['2026-12-28', '2027-01-04'],
      open: '2027-01-04',
    })
  })
})
