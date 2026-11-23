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
    expect(plan).toEqual({ weeks: ['2026-10-12'], open: '2026-10-12', today: '2026-10-14', pastMeals: [] })
    expect(pastDayIndexes(plan.weeks[0], plan.today)).toEqual([0, 1])
  })

  it('a Saturday sign-up (the WhatsApp case of 17-oct): Saturday and Sunday, plus next week whole', () => {
    // Saturday 2026-10-17 11:00 Madrid
    const plan = firstMenuWeeks(new Date('2026-10-17T09:00:00Z'))
    expect(plan).toEqual({ weeks: ['2026-10-12', '2026-10-19'], open: '2026-10-19', today: '2026-10-17', pastMeals: [] })
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

describe('the first menu starts with the next meal that hasn\'t gone by (19-nov)', async () => {
  const { pastMealsOn } = await import('@ona/shared')
  const { withoutPastMeals } = await import('../services/menuWeek.js')
  const next = (iso: string) => firstMenuWeeks(new Date(iso), { fromNextMeal: true })

  it('a 22:00 sign-up starts tomorrow (the case of the fabada «que marcaste como favorita» at lunch)', () => {
    // Wednesday 2026-11-18 22:00 Madrid (21:00 UTC)
    expect(next('2026-11-18T21:00:00Z')).toEqual({ weeks: ['2026-11-16'], open: '2026-11-16', today: '2026-11-19', pastMeals: [] })
  })

  it('a 15:00 sign-up starts with tonight\'s dinner: breakfast and lunch of today are gone', () => {
    const plan = next('2026-11-18T14:00:00Z') // 15:00 Madrid
    expect(plan.today).toBe('2026-11-18')
    expect(plan.pastMeals).toEqual(['breakfast', 'lunch'])
    expect(next('2026-11-18T07:00:00Z').pastMeals).toEqual([]) // 08:00: the whole day
  })

  it('a Sunday-night sign-up gets next week only, from Monday', () => {
    // Sunday 2026-11-22 22:30 Madrid
    expect(next('2026-11-22T21:30:00Z')).toEqual({ weeks: ['2026-11-23'], open: '2026-11-23', today: '2026-11-23', pastMeals: [] })
  })

  it('without fromNextMeal (the calendar week) nothing moves', () => {
    expect(firstMenuWeeks(new Date('2026-11-18T21:00:00Z'))).toEqual({ weeks: ['2026-11-16'], open: '2026-11-16', today: '2026-11-18', pastMeals: [] })
  })

  it('the web\'s fromDate gets the same meals left out, only on that day', () => {
    const at15 = new Date('2026-11-18T14:00:00Z')
    expect(pastMealsOn('2026-11-18', at15)).toEqual(['breakfast', 'lunch'])
    expect(pastMealsOn('2026-11-17', at15)).toEqual([])
    expect(pastMealsOn(undefined, at15)).toEqual([])
  })

  it('withoutPastMeals empties those meals of that day only, never next week\'s Monday', () => {
    const dish = { dishes: [{ kind: 'recipe', recipeId: 'r', recipeName: 'Fabada' }] }
    const week = Array.from({ length: 7 }, () => ({ lunch: dish, dinner: dish })) as any
    const out = withoutPastMeals(week, '2026-11-16', '2026-11-18', ['breakfast', 'lunch'])
    expect(out[2]).toEqual({ dinner: dish })
    expect(out[1]).toEqual({ lunch: dish, dinner: dish })
    expect(week[2].lunch).toBe(dish) // a copy
    expect(withoutPastMeals(week, '2026-11-23', '2026-11-18', ['lunch'])).toBe(week)
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
