/**
 * Red de tiendas: the pure parts of the database layer — whether an order's
 * frozen terms are still the live ones, and what a Red copy in the household's
 * shops looks like (delivery only where the Red shop delivers).
 *
 * Run: pnpm --filter @ona/api test src/tests/redStore.test.ts
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_RED_SETTINGS as S } from '@ona/shared'
import { redCopyValues, sameTerms } from '../services/red/store.js'

const red = (over: Partial<Parameters<typeof redCopyValues>[0]> = {}): Parameters<typeof redCopyValues>[0] => ({
  id: 'r1', name: 'Frutería de prueba', kind: 'fruteria', whatsapp: '34600000091', address: 'Calle de prueba 1', notes: 'Cierra los lunes',
  deliveryPostalCodes: ['28001'], deliveryMinEur: 20, deliveryFeeEur: 3, ...over,
})

describe('sameTerms', () => {
  it('identical terms → true', () => {
    expect(sameTerms({ ...S }, S)).toBe(true)
  })
  it('one field different → false', () => {
    expect(sameTerms({ ...S, discountPct: 6 }, S)).toBe(false)
    expect(sameTerms({ ...S, termsVersion: 'v3' }, S)).toBe(false)
    expect(sameTerms({ ...S, commissionVatIncluded: false }, S)).toBe(false)
  })
  it('no terms frozen on the order → false', () => {
    expect(sameTerms(null, S)).toBe(false)
    expect(sameTerms(undefined, S)).toBe(false)
  })
})

describe('redCopyValues', () => {
  it('delivers to that postal code with a fee → that fee and the minimum', () => {
    expect(redCopyValues(red(), '28001')).toMatchObject({ deliveryFeeEur: 3, deliveryMinEur: 20 })
  })
  it('delivers with no fee typed → free delivery (fee 0)', () => {
    expect(redCopyValues(red({ deliveryFeeEur: null }), '28001')).toMatchObject({ deliveryFeeEur: 0, deliveryMinEur: 20 })
  })
  it('doesn’t deliver to that postal code → no fee and no minimum (pickup only)', () => {
    expect(redCopyValues(red(), '28999')).toMatchObject({ deliveryFeeEur: null, deliveryMinEur: null })
    expect(redCopyValues(red({ deliveryPostalCodes: [] }), '28001')).toMatchObject({ deliveryFeeEur: null, deliveryMinEur: null })
  })
  it('a Mimoia copy: origin red, by WhatsApp, pickup by default, pointing at the Red shop', () => {
    expect(redCopyValues(red(), '28001')).toMatchObject({
      origin: 'red', channel: 'whatsapp', fulfilment: 'recoger', redShopId: 'r1', name: 'Frutería de prueba', kind: 'fruteria',
      whatsapp: '34600000091', email: null, webUrl: null, phone: null,
    })
  })
  it('notes join the address and the shop’s notes', () => {
    expect(redCopyValues(red(), '28001').notes).toBe('Calle de prueba 1 · Cierra los lunes')
    expect(redCopyValues(red({ notes: null }), '28001').notes).toBe('Calle de prueba 1')
    expect(redCopyValues(red({ address: null, notes: null }), '28001').notes).toBeNull()
  })
})
