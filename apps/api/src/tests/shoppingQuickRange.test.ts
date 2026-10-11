/**
 * PRO-33 — /shopping shortcuts «Hoy», «Mañana», «Esta semana»
 * (apps/web/src/lib/shoppingRange.ts).
 *
 * Run: pnpm --filter @ona/api test src/tests/shoppingQuickRange.test.ts
 */

import { describe, expect, it } from 'vitest'
import { activeQuickRange, quickRanges, shiftIso } from '../../../web/src/lib/shoppingRange'

describe('shiftIso', () => {
  it('crosses month and year boundaries', () => {
    expect(shiftIso('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftIso('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('ignores the DST change (Madrid, last Sunday of October)', () => {
    expect(shiftIso('2026-10-24', 1)).toBe('2026-10-25')
    expect(shiftIso('2026-10-25', 1)).toBe('2026-10-26')
  })
})

describe('quickRanges', () => {
  const today = '2026-10-14' // Wednesday
  const defaultTo = '2026-10-25' // end of next week
  const ranges = quickRanges(today, defaultTo)

  it('Hoy = today, Mañana = tomorrow, Esta semana = the default range', () => {
    expect(ranges.map((r) => [r.label, r.from, r.to])).toEqual([
      ['Hoy', '2026-10-14', '2026-10-14'],
      ['Mañana', '2026-10-15', '2026-10-15'],
      ['Esta semana', '2026-10-14', '2026-10-25'],
    ])
  })

  it('Mañana on a Sunday is the next Monday', () => {
    const sun = quickRanges('2026-10-18', '2026-10-25')
    expect(sun[1]).toMatchObject({ from: '2026-10-19', to: '2026-10-19' })
  })

  it('marks the shortcut that matches the range, none for a custom one', () => {
    expect(activeQuickRange(ranges, today, today)).toBe('hoy')
    expect(activeQuickRange(ranges, '2026-10-15', '2026-10-15')).toBe('manana')
    expect(activeQuickRange(ranges, today, defaultTo)).toBe('semana')
    expect(activeQuickRange(ranges, '2026-10-21', '2026-11-01')).toBeNull()
    expect(activeQuickRange(ranges, today, '2026-10-16')).toBeNull()
  })
})
