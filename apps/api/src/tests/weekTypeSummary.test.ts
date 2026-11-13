/**
 * PRO-1204 · «Vuestra semana»: the week type summed up in the profile's grid
 * and in the menu's line of each day.
 */
import { describe, expect, it } from 'vitest'
import { dayLettersLabel, fullWeekTypeDays, schoolWeekdays, summarizeWeekType, weekTypeDayLine, type WeekTypeDays } from '@ona/shared'

const W = '2026-11-09'

function withSlots(slots: Array<[number, 'breakfast' | 'lunch' | 'snack' | 'dinner', object]>): WeekTypeDays {
  const days = fullWeekTypeDays()
  for (const [d, m, slot] of slots) days[d] = { ...days[d], [m]: slot }
  return days
}

describe('summarizeWeekType', () => {
  it('a household without a week type: lunch and dinner free every day, said as the default', () => {
    for (const days of [null, fullWeekTypeDays()]) {
      const s = summarizeWeekType(days, W)
      expect(s.isDefault).toBe(true)
      expect(s.meals).toEqual(['lunch', 'dinner'])
      expect(s.cells.lunch.map((c) => c.kind)).toEqual(Array(7).fill('libre'))
      expect(s.cells.dinner[0]).toEqual({ kind: 'libre', short: 'Libre', label: 'cualquier receta' })
      expect(s.notes).toEqual([])
    }
  })

  it('a meal out reads «Fuera», and the week is no longer the default', () => {
    const s = summarizeWeekType(withSlots([[1, 'dinner', { off: true }], [5, 'lunch', { off: true }]]), W)
    expect(s.isDefault).toBe(false)
    expect(s.cells.dinner[1]).toEqual({ kind: 'fuera', short: 'Fuera', label: 'cena fuera' })
    expect(s.cells.lunch[5].kind).toBe('fuera')
    expect(s.cells.dinner[0].kind).toBe('libre')
  })

  it('cole: a free weekday lunch on a school day, and the note with its days', () => {
    const days = withSlots([[2, 'lunch', { options: [{ kind: 'type', type: 'legumbres' }], since: W }]])
    const school = schoolWeekdays([{ date: '2026-11-09' }, { date: '2026-11-10' }, { date: '2026-11-11' }, { date: '2026-11-12' }, { date: '2026-11-13' }, { date: '2026-11-16' }])
    expect(school).toEqual([0, 1, 2, 3, 4])
    const s = summarizeWeekType(days, W, { school, timeAvailable: { lunes: 30, martes: 30, miercoles: 30, jueves: 30, viernes: 30 } })
    expect(s.cells.lunch.map((c) => c.kind)).toEqual(['cole', 'cole', 'legumbre', 'cole', 'cole', 'libre', 'libre'])
    // A dinner is never «cole».
    expect(s.cells.dinner[0].kind).toBe('libre')
    expect(s.notes).toEqual(['Comen en el cole L, M, J y V', '30 min en total entre semana'])
  })

  it('fijo: something fixed or a concrete recipe; breakfast shows up when some day has it', () => {
    const tostada = { kind: 'fixed', label: 'Tostada', items: [{ name: 'Pan', quantity: 1, unit: 'u' }] }
    const days = withSlots([
      ...[0, 1, 2, 3, 4].map((d) => [d, 'breakfast', { options: [tostada], since: W }] as [number, 'breakfast', object]),
      [4, 'dinner', { options: [{ kind: 'recipe', recipeId: 'r1', name: 'Pizza casera' }], since: W }],
      [3, 'dinner', { options: [{ kind: 'type', type: 'pescado' }], since: W }],
      [1, 'lunch', { options: [{ kind: 'taper' }], since: W }],
    ])
    const s = summarizeWeekType(days, W)
    expect(s.meals).toEqual(['breakfast', 'lunch', 'dinner'])
    expect(s.cells.breakfast[0]).toEqual({ kind: 'fijo', short: 'Tostada', label: 'tostada' })
    expect(s.cells.breakfast[5]).toEqual({ kind: 'fuera', short: 'No hay', label: 'sin desayuno' })
    expect(s.cells.dinner[4]).toEqual({ kind: 'fijo', short: 'Pizza casera', label: 'pizza casera' })
    expect(s.cells.dinner[3]).toEqual({ kind: 'pescado', short: 'Pesc.', label: 'pescado' })
    expect(s.cells.lunch[1]).toEqual({ kind: 'taper', short: 'Táper', label: 'táper' })
  })

  it('by turns, the option of the week shown', () => {
    const days = withSlots([[3, 'dinner', { options: [{ kind: 'type', type: 'ceviche' }, { kind: 'type', type: 'carpaccio-tartar' }], since: W }]])
    expect(summarizeWeekType(days, W).cells.dinner[3].short).toBe('Ceviche')
    expect(summarizeWeekType(days, '2026-11-16').cells.dinner[3].short).toBe('Tartar')
  })
})

describe('weekTypeDayLine', () => {
  const days = withSlots([
    [0, 'lunch', { options: [{ kind: 'type', type: 'legumbres' }], since: W }],
    [0, 'dinner', { off: true }],
    [2, 'dinner', { options: [{ kind: 'type', type: 'pizza' }], since: W }],
  ])

  it('says what the day asks for, lunch first', () => {
    expect(weekTypeDayLine(days, W, 0)).toBe('legumbres y cena fuera')
    expect(weekTypeDayLine(days, W, 2)).toBe('pizza en la cena')
  })

  it('nothing to say on a free day; the cole when it eats there', () => {
    expect(weekTypeDayLine(days, W, 1)).toBeNull()
    expect(weekTypeDayLine(days, W, 1, [1])).toBe('cole a mediodía')
    expect(weekTypeDayLine(null, W, 6)).toBeNull()
  })
})

describe('dayLettersLabel', () => {
  it('a run as «de L a V», else a list', () => {
    expect(dayLettersLabel([0, 1, 2, 3, 4])).toBe('de L a V')
    expect(dayLettersLabel([0, 2])).toBe('L y X')
    expect(dayLettersLabel([5])).toBe('el S')
  })
})
