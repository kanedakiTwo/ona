/**
 * PRO-110: «¿Qué tal?» after cooking — when to ask (specs/cook-log.md).
 */
import { describe, expect, it } from 'vitest'
import { RATING_PROMPT_CHOICES, shouldAskRating } from '@ona/shared'

const now = new Date('2026-10-16T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()

describe('shouldAskRating', () => {
  it('asks when the recipe has no notes row or no rating', () => {
    expect(shouldAskRating(null, now)).toBe(true)
    expect(shouldAskRating({ rating: null, updatedAt: daysAgo(1) }, now)).toBe(true)
  })
  it('does not ask again within 30 days of a rating', () => {
    expect(shouldAskRating({ rating: 5, updatedAt: daysAgo(0) }, now)).toBe(false)
    expect(shouldAskRating({ rating: 1, updatedAt: daysAgo(29) }, now)).toBe(false)
  })
  it('asks again from day 30', () => {
    expect(shouldAskRating({ rating: 3, updatedAt: daysAgo(30) }, now)).toBe(true)
  })
})

describe('RATING_PROMPT_CHOICES', () => {
  it('maps the three answers onto the existing 1–5 rating', () => {
    expect(RATING_PROMPT_CHOICES.map((c) => [c.label, c.rating])).toEqual([
      ['Repetir a menudo', 5],
      ['Bien', 3],
      ['Mejor no', 1],
    ])
  })
})
