/**
 * Pure-logic tests for `summarizeCookLog` — the reducer that turns a raw
 * list of cook_log rows into `{ count, lastCookedAt }` for a recipe card
 * badge. Kept as a pure function so the route handler doesn't have to do
 * the date math, and so a regression in "most-recent" or counting trips
 * a unit failure instead of a UX bug.
 */
import { describe, expect, it } from 'vitest'
import { summarizeCookLog, type CookLogRow } from '../services/cookLogStore.js'

const D = (s: string) => new Date(s)

describe('summarizeCookLog', () => {
  it('returns zero count + null timestamp on empty input', () => {
    const s = summarizeCookLog([])
    expect(s.count).toBe(0)
    expect(s.lastCookedAt).toBeNull()
  })

  it('counts every row regardless of cookedAt ordering', () => {
    const rows: CookLogRow[] = [
      { cookedAt: D('2026-04-01T10:00:00Z') },
      { cookedAt: D('2026-04-15T18:00:00Z') },
      { cookedAt: D('2026-03-20T08:30:00Z') },
    ]
    expect(summarizeCookLog(rows).count).toBe(3)
  })

  it('picks the most recent cookedAt as lastCookedAt', () => {
    const rows: CookLogRow[] = [
      { cookedAt: D('2026-04-01T10:00:00Z') },
      { cookedAt: D('2026-04-15T18:00:00Z') }, // ← latest
      { cookedAt: D('2026-03-20T08:30:00Z') },
    ]
    const s = summarizeCookLog(rows)
    expect(s.lastCookedAt?.toISOString()).toBe('2026-04-15T18:00:00.000Z')
  })

  it('handles a single row', () => {
    const s = summarizeCookLog([{ cookedAt: D('2026-05-01T12:00:00Z') }])
    expect(s.count).toBe(1)
    expect(s.lastCookedAt?.toISOString()).toBe('2026-05-01T12:00:00.000Z')
  })
})
