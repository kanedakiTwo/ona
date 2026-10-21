/**
 * PRO-33 — /shopping shortcuts «Hoy», «Mañana», «Esta semana»; PRO-269 —
 * «Esta semana» is this week only, plus «La que viene» and «Dos semanas»,
 * and the week each line is for (apps/web/src/lib/shoppingRange.ts).
 *
 * Run: pnpm --filter @ona/api test src/tests/shoppingQuickRange.test.ts
 */

import { describe, expect, it } from 'vitest'
import { activeQuickRange, lineWeekLabel, mondayOfIso, quickRanges, shiftIso, spansWeeks, totalTitle } from '../../../web/src/lib/shoppingRange'

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
  const ranges = quickRanges(today)

  it('the chip says what it shows (PRO-269: «Esta semana» was the two weeks)', () => {
    expect(ranges.map((r) => [r.label, r.from, r.to])).toEqual([
      ['Hoy', '2026-10-14', '2026-10-14'],
      ['Mañana', '2026-10-15', '2026-10-15'],
      ['Esta semana', '2026-10-14', '2026-10-18'],
      ['La que viene', '2026-10-19', '2026-10-25'],
      ['Dos semanas', '2026-10-14', '2026-10-25'],
    ])
  })

  it('Laura on Monday 19: «Esta semana» is 19–25, not «19 oct – 1 nov»', () => {
    const r = quickRanges('2026-10-19')
    expect(r.find((x) => x.key === 'semana')).toMatchObject({ from: '2026-10-19', to: '2026-10-25' })
    expect(r.find((x) => x.key === 'siguiente')).toMatchObject({ from: '2026-10-26', to: '2026-11-01' })
    expect(r.find((x) => x.key === 'dos')).toMatchObject({ from: '2026-10-19', to: '2026-11-01' })
  })

  it('on a Sunday: Mañana is the next Monday and «Esta semana» is just today', () => {
    const sun = quickRanges('2026-10-18')
    expect(sun[1]).toMatchObject({ from: '2026-10-19', to: '2026-10-19' })
    expect(sun[2]).toMatchObject({ from: '2026-10-18', to: '2026-10-18' })
    expect(sun[3]).toMatchObject({ from: '2026-10-19', to: '2026-10-25' })
    // «Hoy» and «Esta semana» are the same day: the tapped one is marked.
    expect(activeQuickRange(sun, '2026-10-18', '2026-10-18')).toBe('hoy')
    expect(activeQuickRange(sun, '2026-10-18', '2026-10-18', 'semana')).toBe('semana')
  })

  it('marks the shortcut that matches the range, none for a custom one', () => {
    expect(activeQuickRange(ranges, today, today)).toBe('hoy')
    expect(activeQuickRange(ranges, '2026-10-15', '2026-10-15')).toBe('manana')
    expect(activeQuickRange(ranges, today, '2026-10-18')).toBe('semana')
    expect(activeQuickRange(ranges, '2026-10-19', '2026-10-25')).toBe('siguiente')
    expect(activeQuickRange(ranges, today, '2026-10-25')).toBe('dos')
    expect(activeQuickRange(ranges, '2026-10-21', '2026-11-01')).toBeNull()
    expect(activeQuickRange(ranges, today, '2026-10-16')).toBeNull()
    // A preferred key that doesn't match is ignored.
    expect(activeQuickRange(ranges, today, '2026-10-25', 'semana')).toBe('dos')
  })
})

describe('totalTitle (PRO-69)', () => {
  it('names the day or the week of the shortcut, and keeps the weekly title otherwise', () => {
    expect(totalTitle('hoy')).toBe('Total de hoy estimado')
    expect(totalTitle('manana')).toBe('Total de mañana estimado')
    expect(totalTitle('semana')).toBe('Total de esta semana estimado')
    expect(totalTitle('siguiente')).toBe('Total de la semana que viene estimado')
    expect(totalTitle('dos')).toBe('Total de las dos semanas estimado')
    expect(totalTitle(null)).toBe('Total semanal estimado')
  })
})

describe('the week of each line (PRO-269)', () => {
  const today = '2026-10-20' // Tuesday
  it('names the week from the line\'s weeks', () => {
    expect(lineWeekLabel({ '2026-10-19': 400 }, today)).toBe('Esta semana')
    expect(lineWeekLabel({ '2026-10-26': 750 }, today)).toBe('La que viene')
    expect(lineWeekLabel({ '2026-10-19': 400, '2026-10-26': 350 }, today)).toBe('Las dos semanas')
    expect(lineWeekLabel({ '2026-11-02': 1 }, today)).toBe('Semana del 2 nov')
    expect(lineWeekLabel({ '2026-10-19': 0, '2026-10-26': 5 }, today)).toBe('La que viene')
    expect(lineWeekLabel(undefined, today)).toBeNull()
  })
  it('only a range over more than one week shows it', () => {
    expect(spansWeeks('2026-10-20', '2026-10-25')).toBe(false)
    expect(spansWeeks('2026-10-20', '2026-11-01')).toBe(true)
    expect(spansWeeks('2026-10-25', '2026-10-26')).toBe(true)
    expect(mondayOfIso('2026-10-25')).toBe('2026-10-19')
  })
})
