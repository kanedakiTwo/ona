/**
 * PRO-389 (D-160): «Que Mimoia se pague sola» — the answer from the closed
 * lists only, and the households per option and ISO week for GET /admin/usage.
 */
import { describe, expect, it } from 'vitest'
import { buildOfferInterest, offerInterestInput } from '../services/offerInterest.js'
import { USAGE_EVENTS, PASSIVE_USAGE_EVENTS } from '../services/usageEvents.js'
import { dayRange } from '../services/usageReport.js'

describe('offerInterestInput', () => {
  it('takes the three options and the two places', () => {
    expect(offerInterestInput({ option: 'tiendas', where: 'suscripcion' })).toEqual({ option: 'tiendas', where: 'suscripcion' })
    expect(offerInterestInput({ option: 'carrefour', where: 'precios' })).toEqual({ option: 'carrefour', where: 'precios' })
    expect(offerInterestInput({ option: 'ninguna', where: 'precios', extra: 'x' })).toEqual({ option: 'ninguna', where: 'precios' })
  })

  it('anything else is not an answer', () => {
    expect(offerInterestInput({ option: 'lidl', where: 'precios' })).toBeNull()
    expect(offerInterestInput({ option: 'tiendas', where: 'menu' })).toBeNull()
    expect(offerInterestInput({ option: 'tiendas' })).toBeNull()
    expect(offerInterestInput(null)).toBeNull()
    expect(offerInterestInput(['tiendas', 'precios'])).toBeNull()
  })

  it('is a known, passive usage event', () => {
    expect(USAGE_EVENTS).toContain('offer_interest')
    expect(PASSIVE_USAGE_EVENTS.has('offer_interest')).toBe(true)
  })
})

describe('buildOfferInterest (recuento)', () => {
  // Wednesday 2026-11-11 … Tuesday 2026-11-24: three ISO weeks (9, 16 and 23 Nov).
  const days = dayRange('2026-11-11', '2026-11-24')

  it('households per option and week, zeros included, and the totals', () => {
    const r = buildOfferInterest(days, [
      { day: '2026-11-12', option: 'tiendas', households: 2 },
      { day: '2026-11-15', option: 'carrefour', households: 1 },
      { day: '2026-11-17', option: 'tiendas', households: 1 },
      { day: '2026-11-18', option: 'ninguna', households: 3 },
      { day: '2026-11-18', option: 'carrefour', households: 2 },
    ])
    expect(r.weekly).toEqual([
      { week: '2026-11-09', isoWeek: '2026-W46', tiendas: 2, carrefour: 1, ninguna: 0, total: 3 },
      { week: '2026-11-16', isoWeek: '2026-W47', tiendas: 1, carrefour: 2, ninguna: 3, total: 6 },
      { week: '2026-11-23', isoWeek: '2026-W48', tiendas: 0, carrefour: 0, ninguna: 0, total: 0 },
    ])
    expect(r.totals).toEqual({ tiendas: 3, carrefour: 3, ninguna: 3, total: 9 })
  })

  it('drops options outside the list and days outside the window', () => {
    const r = buildOfferInterest(days, [
      { day: '2026-11-17', option: 'lidl', households: 5 },
      { day: '2026-10-01', option: 'tiendas', households: 4 },
    ])
    expect(r.totals).toEqual({ tiendas: 0, carrefour: 0, ninguna: 0, total: 0 })
    expect(r.weekly.every((w) => w.total === 0)).toBe(true)
  })
})
