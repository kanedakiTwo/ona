/**
 * PRO-364: which saved slots the review may still change. Days already past
 * and today's meals past their hour (the shopping list's cutoffs) stay.
 * PRO-1067: fixed slots, hand picks and the «En lugar de …» of the card.
 */
import { describe, it, expect } from 'vitest'
import { replacedDishLine, type DayMenu, type RecipeDish } from '@ona/shared'
import { reviewDays, savedRestrictions, slotIsAhead, type ReviewDaysInput } from '../services/menuRestrictionsReview.js'

// Saturday 2026-10-24, 13:30 in Madrid (11:30 UTC, CEST). Week of Monday 2026-10-19.
const now = new Date('2026-10-24T11:30:00Z')

describe('slotIsAhead', () => {
  it('days before today are past', () => {
    expect(slotIsAhead('2026-10-19', 0, 'lunch', now)).toBe(false)
    expect(slotIsAhead('2026-10-19', 4, 'dinner', now)).toBe(false)
    expect(slotIsAhead('2026-10-12', 6, 'dinner', now)).toBe(false)
  })

  it('today: only the meals not past yet', () => {
    expect(slotIsAhead('2026-10-19', 5, 'breakfast', now)).toBe(false)
    expect(slotIsAhead('2026-10-19', 5, 'lunch', now)).toBe(true)
    expect(slotIsAhead('2026-10-19', 5, 'dinner', now)).toBe(true)
    const evening = new Date('2026-10-24T17:00:00Z') // 19:00 Madrid
    expect(slotIsAhead('2026-10-19', 5, 'lunch', evening)).toBe(false)
    expect(slotIsAhead('2026-10-19', 5, 'snack', evening)).toBe(false)
    expect(slotIsAhead('2026-10-19', 5, 'dinner', evening)).toBe(true)
  })

  it('tomorrow and next week are ahead', () => {
    expect(slotIsAhead('2026-10-19', 6, 'breakfast', now)).toBe(true)
    expect(slotIsAhead('2026-10-26', 5, 'lunch', now)).toBe(true)
  })
})

// ─── PRO-1067: what the review does with each dish ──────────

const WEEK = '2026-10-26' // the Monday after `now`
const pizza: RecipeDish = { kind: 'recipe', recipeId: 'pizza', recipeName: 'Pizza margarita', course: 'main' }

/** Pizza on Saturday's lunch, and its leftover on Sunday's. */
function weekWithPizza(): DayMenu[] {
  const days: DayMenu[] = [{}, {}, {}, {}, {}, {}, {}]
  days[5] = { lunch: { dishes: [{ ...pizza }] } }
  days[6] = { lunch: { dishes: [{ ...pizza, variant: 'leftover', leftoverOf: { day: 5, meal: 'lunch', dishPosition: 0 } }] } }
  return days
}

function input(over: Partial<ReviewDaysInput> = {}): ReviewDaysInput {
  return {
    days: weekWithPizza(),
    weekStart: WEEK,
    now,
    breaks: (id) => id === 'pizza',
    breaksSaved: (id) => id === 'pizza',
    handPicked: () => false,
    pick: async () => ({ id: 'lentejas', name: 'Lentejas guisadas', course: 'main' }),
    ...over,
  }
}

const saturday = (days: DayMenu[]) => days[5].lunch!.dishes[0] as RecipeDish
const sunday = (days: DayMenu[]) => days[6].lunch!.dishes[0] as RecipeDish
const pickedByHand = (day: number, meal: string, id: string) => day === 5 && meal === 'lunch' && id === 'pizza'

describe('reviewDays (PRO-1067)', () => {
  it('(1) a «Fijada» slot is changed too, safety first, and says so', async () => {
    // The review no longer reads `menus.locked`: a fixed slot goes the same way as any other.
    const out = await reviewDays(input())
    expect(saturday(out.days).recipeId).toBe('lentejas')
    expect(saturday(out.days).replaced).toEqual({ recipeName: 'Pizza margarita', reason: 'restrictions' })
    expect(saturday(out.days).restrictionConflict).toBeUndefined()
    expect(out.swapped).toEqual([
      { day: 5, meal: 'lunch', before: 'Pizza margarita', after: 'Lentejas guisadas' },
      { day: 6, meal: 'lunch', before: 'Pizza margarita', after: 'Lentejas guisadas' },
    ])
  })

  it('(1) nothing else fits: it stays, with the warning', async () => {
    const out = await reviewDays(input({ pick: async () => null }))
    expect(saturday(out.days)).toMatchObject({ recipeId: 'pizza', restrictionConflict: true })
    expect(out.warned.map((w) => w.day)).toEqual([5, 6])
  })

  it('(2) picked by hand breaking a rule it already had: stays as it is', async () => {
    const out = await reviewDays(input({ handPicked: pickedByHand, breaksSaved: () => false }))
    expect(out.changed).toBe(false)
    expect(saturday(out.days)).toEqual(pizza)
    // Its leftover follows the hand pick.
    expect(sunday(out.days).recipeId).toBe('pizza')
    expect(out.swapped).toEqual([])
    expect(out.warned).toEqual([])
  })

  it('(2) picked by hand, but what was just saved is what it breaks: changed', async () => {
    const out = await reviewDays(input({ handPicked: pickedByHand }))
    expect(saturday(out.days).recipeId).toBe('lentejas')
    expect(sunday(out.days).recipeId).toBe('lentejas')
  })

  it('(3) the new dish and its leftover carry «En lugar de …» for the card', async () => {
    const out = await reviewDays(input())
    expect(sunday(out.days)).toMatchObject({ recipeId: 'lentejas', variant: 'leftover', replaced: { recipeName: 'Pizza margarita', reason: 'restrictions' } })
    expect(replacedDishLine(saturday(out.days).replaced!)).toBe('En lugar de «Pizza margarita», que no encaja con vuestras alergias o dieta')
    // PRO-345's lines don't change.
    expect(replacedDishLine({ recipeName: 'Fajitas de pollo', reason: 'diet' })).toBe('En lugar de «Fajitas de pollo», que ha cambiado y ya no encaja con vuestra dieta')
  })

  it('savedRestrictions: only what wasn’t there before', () => {
    expect(savedRestrictions(['sin gluten', 'Sin lactosa'], ['sin lactosa '])).toEqual(['sin gluten'])
    expect(savedRestrictions(['sin gluten'], ['sin gluten'])).toEqual([])
    expect(savedRestrictions(['vegetariano'], [])).toEqual(['vegetariano'])
  })
})
