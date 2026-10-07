/**
 * Shop-reply parser (specs/shop-orders.md): the model's JSON is normalised
 * so a sloppy answer can only make a line go back to the user, never
 * invent a price.
 *
 * Run: pnpm --filter @ona/api test src/tests/shopQuoteParser.test.ts
 */

import { describe, it, expect } from 'vitest'
import { normalizeParsedReply, parseShopReply, toNumber } from '../services/shopOrders/quoteParser.js'

const keys = new Set(['l1', 'l2', 'l3'])

describe('toNumber', () => {
  it.each([
    [12.5, 12.5],
    ['12,50 €', 12.5],
    ['36.85', 36.85],
    ['unos 20€/kg', 20],
    ['', null],
    ['nada', null],
    [null, null],
    [-3, null],
  ])('%s → %s', (input, out) => {
    expect(toNumber(input)).toBe(out)
  })
})

describe('normalizeParsedReply', () => {
  it('keeps known keys with valid statuses and coerces numbers', () => {
    const r = normalizeParsedReply(
      {
        lines: [
          { key: 'l1', status: 'ok', quantity: '1,4 kg', price_per_kg: '24', line_total: '33,60', substitute: null },
          { key: 'l2', status: 'sustituto', substitute: 'pescadilla' },
          { key: 'l3', status: 'no_hay' },
        ],
        total_eur: '36,85 €',
        pickup: 'sábado de 10 a 12',
        payment: 'en tienda',
      },
      keys,
    )
    expect(r.lines.l1).toEqual({ status: 'ok', quantityText: '1,4 kg', pricePerKg: 24, lineTotal: 33.6, substitute: null, comment: null })
    expect(r.lines.l2.substitute).toBe('pescadilla')
    expect(r.lines.l3.status).toBe('no_hay')
    expect(r.totalEur).toBe(36.85)
    expect(r.pickupText).toBe('sábado de 10 a 12')
    expect(r.paymentText).toBe('en tienda')
  })
  it('drops unknown keys and unknown statuses (the line then goes back to the user)', () => {
    const r = normalizeParsedReply({ lines: [{ key: 'zz', status: 'ok' }, { key: 'l1', status: 'quizas' }] }, keys)
    expect(r.lines).toEqual({})
  })
  it('only keeps a substitute when the status says so', () => {
    const r = normalizeParsedReply({ lines: [{ key: 'l1', status: 'ok', substitute: 'otra cosa' }] }, keys)
    expect(r.lines.l1.substitute).toBeNull()
  })
  it('survives garbage', () => {
    expect(normalizeParsedReply(null, keys)).toEqual({ lines: {}, totalEur: null, pickupText: null, paymentText: null, notes: null })
    expect(normalizeParsedReply({ lines: 'x' }, keys).lines).toEqual({})
  })
})

describe('parseShopReply', () => {
  const lines = [
    { key: 'l1', name: 'merluza', quantity: 600, unit: 'g' as const, note: null },
    { key: 'l2', name: 'mejillones', quantity: 1000, unit: 'g' as const, note: null },
  ]

  it('sends the order lines with their keys and parses a fenced JSON answer', async () => {
    let sent = ''
    const r = await parseShopReply(
      { text: 'Merluza 1,4 kg a 24, mejillón no hay', kind: 'pescaderia', lines },
      {
        create: async (p) => {
          sent = String((p.messages[0] as any).content)
          return {
            content: [{ type: 'text', text: '```json\n{"lines":[{"key":"l1","status":"ok","price_per_kg":24,"line_total":33.6},{"key":"l2","status":"no_hay"}],"total_eur":33.6}\n```', citations: null } as any],
            usage: { input_tokens: 10, output_tokens: 10 } as any,
          }
        },
      },
    )
    expect(sent).toContain('l1: Merluza: 600 g en limpio')
    expect(sent).toContain('RESPUESTA DE LA TIENDA:\nMerluza 1,4 kg a 24, mejillón no hay')
    expect(r?.lines.l1.lineTotal).toBe(33.6)
    expect(r?.lines.l2.status).toBe('no_hay')
    expect(r?.totalEur).toBe(33.6)
  })

  it('returns null when the model call fails or answers non-JSON', async () => {
    expect(await parseShopReply({ text: 'x', kind: 'fruteria', lines }, { create: async () => { throw new Error('down') } })).toBeNull()
    expect(
      await parseShopReply(
        { text: 'x', kind: 'fruteria', lines },
        { create: async () => ({ content: [{ type: 'text', text: 'no sé', citations: null } as any], usage: { input_tokens: 1, output_tokens: 1 } as any }) },
      ),
    ).toBeNull()
  })
})
