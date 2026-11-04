/**
 * Red de tiendas: what the household sees of a Red order (estimate and max
 * with the discount, fee, blockers) and its links (never wa.me).
 *
 * Run: pnpm --filter @ona/api test src/tests/redView.test.ts
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_RED_SETTINGS as S, type ShopOrderLine, type ShopSnapshot } from '@ona/shared'
import { minimumMax, redBlockers, redView } from '../services/red/view.js'
import { isRedOrderRow, presentOrder, resolveShortLink } from '../services/shopOrders/store.js'

const line = (over: Partial<ShopOrderLine> = {}): ShopOrderLine => ({
  key: 'l1', sourceItemId: 'manual:m', ingredientId: null, name: 'manzanas', quantity: 1000, unit: 'g', note: null,
  estimateEur: 10, estimateSource: 'historial', volatile: false, quote: null, verdict: null, reasons: [], decision: null, ...over,
})
const snap = (over: Partial<ShopSnapshot> = {}): ShopSnapshot => ({
  name: 'Frutería de prueba', kind: 'fruteria', channel: 'whatsapp', whatsapp: '34600000091', email: null, webUrl: null, phone: null,
  deliveryMinEur: null, deliveryFeeEur: null, red: { shopId: 'r1', origin: 'red' }, ...over,
})
const input = (over: Partial<Parameters<typeof redView>[0]> = {}) => ({
  redShopId: 'r1', terms: S, lines: [line(), line({ key: 'l2', estimateEur: 8, estimateSource: 'manual' })], fulfilment: 'recoger' as const,
  snapshot: snap(), maxEur: null, ...over,
})

describe('redView', () => {
  it('design example: 18 € → ≈17,10 €, como mucho 20 €, the shop up to 21,05 €', () => {
    const v = redView(input())
    expect(v).toMatchObject({ estimateShopEur: 18, estimateEur: 17.1, feeEur: null, ceilingShopEur: 20.7, maxEur: 20, maxRaised: false, shopCeilingEur: 21.05, delivers: false, ownShopJoined: false })
  })
  it('home delivery adds the fee to the max, not to the discount', () => {
    const v = redView(input({ fulfilment: 'domicilio', snapshot: snap({ deliveryFeeEur: 3.5, deliveryMinEur: 20 }) }))
    expect(v).toMatchObject({ feeEur: 3.5, maxEur: 24, delivers: true })
  })
  it('a raised max wins and is flagged', () => {
    expect(redView(input({ maxEur: 30 }))).toMatchObject({ maxEur: 30, maxRaised: true, shopCeilingEur: 31.57 })
  })
  it('the household’s own shop that joined the Red: flagged, and it may deliver even without a fee typed', () => {
    const v = redView(input({ snapshot: snap({ red: { shopId: 'r1', origin: 'propia' } }) }))
    expect(v).toMatchObject({ ownShopJoined: true, delivers: true })
  })
  it('minimumMax: what is expected plus the fee, up to the euro', () => {
    expect(minimumMax(redView(input()))).toBe(18) // 17,10 → 18
  })
})

describe('redBlockers', () => {
  it('a line without estimate asks for a max', () => {
    const v = redView(input({ lines: [line({ estimateEur: null, estimateSource: null })] }))
    expect(redBlockers(v, null, 'recoger')).toEqual(['Hay productos sin precio estimado: pon un máximo'])
  })
  it('home delivery from a shop that doesn’t deliver there, and under the minimum', () => {
    const v = redView(input({ fulfilment: 'domicilio' }))
    expect(redBlockers(v, null, 'domicilio')).toContain('Esta tienda no reparte en tu código postal: recógelo en la tienda')
    const d = { minEur: 30, feeEur: 3, estimateEur: 18, confident: true, shortByEur: 12 }
    expect(redBlockers(redView(input({ fulfilment: 'domicilio', snapshot: snap({ deliveryFeeEur: 3, deliveryMinEur: 30 }) })), d, 'domicilio'))
      .toEqual(['No llegas al mínimo a domicilio (30 €): añade algo o recógelo en la tienda'])
  })
})

describe('presentOrder with a Red order', () => {
  const row = {
    id: '7d9f2c1e-0b4a-4c3e-9f1a-2b3c4d5e6f70', householdId: 'hh', userId: 'u', shopId: 's1', shopSnapshot: snap(), status: 'draft', token: 'TOKENTOKENTOKEN1',
    lines: [line()], estimateEur: 10, capEur: null, messageText: 'Hola', fulfilment: 'recoger', address: null, shopReplyText: null, quoteSummary: null,
    confirmationText: null, finalTotalEur: null, extensionResult: null, redShopId: 'r1', redTerms: S, maxEur: null, orderedAt: null, orderedByUserId: null,
    createdAt: new Date(), updatedAt: new Date(), sentAt: null, quotedAt: null, approvedAt: null, closedAt: null,
  } as any
  it('carries the view, a /c/ short link and no wa.me', () => {
    const o = presentOrder(row)
    expect(o.red?.estimateEur).toBe(9.5)
    expect(o.links.order).toBeNull()
    expect(o.links.shortOrder).toMatch(/\/c\/TOKENTOKENTOKEN1$/)
    expect(o.links.view).toMatch(/\/compra\?pedido=7d9f2c1e/)
  })
  it('an order without red_shop_id stays as today', () => {
    const o = presentOrder({ ...row, redShopId: null, redTerms: null, shopSnapshot: snap({ red: null }) })
    expect(o.red ?? null).toBeNull()
    expect(o.links.order).toMatch(/^https:\/\/wa\.me\//)
  })

  // resolveShortLink reads one row: db.select().from().where().limit().
  const oneRow = (r: unknown) => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [r] }) }) }) }) as any
  it('its short link opens the card on /compra (relative), and there is no confirmation link', async () => {
    expect(await resolveShortLink(row.token, 'order', oneRow(row))).toBe(`/compra?pedido=${row.id}`)
    expect(await resolveShortLink(row.token, 'confirmation', oneRow(row))).toBeNull()
  })
  it('one rule for what a Red order is: a red_shop_id without frozen terms is not one, for the card nor the short link', async () => {
    const r = { ...row, redTerms: null }
    expect(isRedOrderRow(r)).toBe(false)
    expect(isRedOrderRow(row)).toBe(true)
    expect(presentOrder(r).red ?? null).toBeNull()
    expect(await resolveShortLink(r.token, 'order', oneRow(r))).toMatch(/^https:\/\/wa\.me\//)
  })
})
