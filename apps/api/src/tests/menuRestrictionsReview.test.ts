/**
 * PRO-364: which saved slots the review may still change. Days already past
 * and today's meals past their hour (the shopping list's cutoffs) stay.
 */
import { describe, it, expect } from 'vitest'
import { slotIsAhead } from '../services/menuRestrictionsReview.js'

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
