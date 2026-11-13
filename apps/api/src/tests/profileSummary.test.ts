/**
 * PRO-1202: the one-line statuses of the /profile rows
 * (apps/web/src/lib/profileSummary.ts).
 */
import { describe, expect, it } from 'vitest'
import { cuisinesLine, dislikesOfHouse, listLine, skillLine, timeLine } from '../../../web/src/lib/profileSummary'

describe('profile summary lines', () => {
  it('says the time on weekdays and at the weekend', () => {
    expect(timeLine({ lunes: 30, sabado: { mode: 'total', minutes: 90 } })).toBe('30 min entre semana · 90 min el finde')
    expect(timeLine({ lunes: { mode: 'activo', minutes: 20 } })).toBe('20 min de trabajo entre semana')
    expect(timeLine(undefined)).toBeNull()
    expect(timeLine({})).toBeNull()
  })

  it('lists a few things and counts the rest', () => {
    expect(listLine(['horno', 'freidora de aire'])).toBe('Horno, freidora de aire')
    expect(listLine(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('A, b, c, d y 2 más')
    expect(listLine([])).toBeNull()
    expect(listLine('horno')).toBeNull()
  })

  it('names the level', () => {
    expect(skillLine('easy')).toBe('Nivel fácil')
    expect(skillLine('nope')).toBeNull()
  })

  it('orders the cuisines and hearts the loved ones', () => {
    expect(cuisinesLine({ italiana: 60, española: 90, asiática: 20, francesa: 0 })).toBe('Española ♥, Italiana, Asiática')
    expect(cuisinesLine({})).toBeNull()
    expect(cuisinesLine(null)).toBeNull()
  })

  it('puts together what nobody likes, once each', () => {
    expect(dislikesOfHouse([['Pimiento', 'cilantro'], null, ['pimiento ', 'hígado'], undefined])).toEqual(['Pimiento', 'cilantro', 'hígado'])
  })
})
