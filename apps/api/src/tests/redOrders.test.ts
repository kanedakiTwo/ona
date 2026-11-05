/**
 * Red de tiendas: the decisions behind «Pedir» (empty, blocked, the max the
 * household saw) and behind editing a Red draft's «como mucho» (too low, kept,
 * or back to the computed one when what's ordered changes); which shops
 * «Preparar» drafts for when the Red is off or failed; and when an own shop
 * stops being linked to the Red.
 * TERMS_CHANGED: the comparison is `sameTerms` (redStore.test.ts); the refresh
 * at «Pedir» (409, new terms on the draft, max reset, the next «Pedir» goes)
 * is in redOrders.smoke.ts, against the real database.
 *
 * Run: pnpm --filter @ona/api test src/tests/redOrders.test.ts
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_RED_SETTINGS as S, type ShopOrderLine, type ShopSnapshot } from '@ona/shared'
import { nextRedMax, redOrderRefusal, redView } from '../services/red/view.js'
import { draftableShops, keepsRedLink, presentOrder, type OrderPatch } from '../services/shopOrders/store.js'

const line = (over: Partial<ShopOrderLine> = {}): ShopOrderLine => ({
  key: 'l1', sourceItemId: 'manual:m', ingredientId: null, name: 'manzanas', quantity: 1000, unit: 'g', note: null,
  estimateEur: 10, estimateSource: 'historial', volatile: false, quote: null, verdict: null, reasons: [], decision: null, ...over,
})
const snap = (over: Partial<ShopSnapshot> = {}): ShopSnapshot => ({
  name: 'Frutería de prueba', kind: 'fruteria', channel: 'whatsapp', whatsapp: '34600000091', email: null, webUrl: null, phone: null,
  deliveryMinEur: null, deliveryFeeEur: null, red: { shopId: 'r1', origin: 'red' }, ...over,
})
const lines = () => [line(), line({ key: 'l2', estimateEur: 8, estimateSource: 'manual' })]
const row = (over: Record<string, unknown> = {}) =>
  ({
    id: '7d9f2c1e-0b4a-4c3e-9f1a-2b3c4d5e6f70', householdId: 'hh', userId: 'u', shopId: 's1', shopSnapshot: snap(), status: 'draft', token: 'TOKENTOKENTOKEN1',
    lines: lines(), estimateEur: 18, capEur: null, messageText: 'Hola', fulfilment: 'recoger', address: null, shopReplyText: null, quoteSummary: null,
    confirmationText: null, finalTotalEur: null, extensionResult: null, redShopId: 'r1', redTerms: S, maxEur: null, orderedAt: null, orderedByUserId: null,
    createdAt: new Date(), updatedAt: new Date(), sentAt: null, quotedAt: null, approvedAt: null, closedAt: null, ...over,
  }) as any

describe('redOrderRefusal («Pedir»)', () => {
  it('a ready draft with the max the household saw (20 €) goes ahead; under half a cent of rounding is the same max, a cent is not', () => {
    const o = presentOrder(row())
    expect(o.red?.maxEur).toBe(20)
    expect(redOrderRefusal(o, 20)).toBeNull()
    expect(redOrderRefusal(o, 20.001)).toBeNull()
    expect(redOrderRefusal(o, 20.01)).toMatchObject({ code: 'MAX_CHANGED' })
  })
  it('a raised max is the one to accept', () => {
    const o = presentOrder(row({ maxEur: 30 }))
    expect(redOrderRefusal(o, 30)).toBeNull()
    expect(redOrderRefusal(o, 20)).toMatchObject({ code: 'MAX_CHANGED' })
  })
  it('another max than the one on the card: MAX_CHANGED', () => {
    expect(redOrderRefusal(presentOrder(row()), 19)).toEqual({ code: 'MAX_CHANGED', message: 'El máximo ha cambiado: revísalo antes de pedir.' })
  })
  it('nothing to order: EMPTY (no lines, or every line left out)', () => {
    expect(redOrderRefusal(presentOrder(row({ lines: [] })), 20)).toMatchObject({ code: 'EMPTY' })
    const out = [line({ included: false }), line({ key: 'l2', included: false })]
    expect(redOrderRefusal(presentOrder(row({ lines: out })), 20)).toMatchObject({ code: 'EMPTY' })
  })
  it('a blocker stops it, with the first blocker as the message', () => {
    const noAddress = presentOrder(row({ fulfilment: 'domicilio', shopSnapshot: snap({ deliveryFeeEur: 3 }) }))
    expect(redOrderRefusal(noAddress, noAddress.red!.maxEur!)).toEqual({ code: 'BLOCKED', message: 'Falta la dirección de entrega' })
    const noPrice = presentOrder(row({ lines: [line({ estimateEur: null, estimateSource: null })] }))
    expect(redOrderRefusal(noPrice, 20)).toEqual({ code: 'BLOCKED', message: 'Hay productos sin precio estimado: pon un máximo' })
  })
})

describe('nextRedMax (editing a Red draft)', () => {
  const view = redView({ redShopId: 'r1', terms: S, lines: lines(), fulfilment: 'recoger', snapshot: snap(), maxEur: null })
  const p = (patch: OrderPatch) => patch

  it('a max below what is expected (18 €) is refused', () => {
    expect(nextRedMax(p({ maxEur: 17 }), 'recoger', view)).toEqual({
      refusal: { code: 'MAX_TOO_LOW', message: 'El máximo no puede bajar de 18 €: es lo previsto.' },
    })
  })
  it('a max asked for wins, even with other changes; null brings back the computed one', () => {
    expect(nextRedMax(p({ maxEur: 18 }), 'recoger', view)).toEqual({ maxEur: 18 })
    expect(nextRedMax(p({ maxEur: 25, lines: [{ key: 'l1', quantity: 2000 }] }), 'recoger', view)).toEqual({ maxEur: 25 })
    expect(nextRedMax(p({ maxEur: null }), 'recoger', view)).toEqual({ maxEur: null })
  })
  it('with no expected price there is no floor', () => {
    const unpriced = redView({ redShopId: 'r1', terms: S, lines: [line({ estimateEur: null, estimateSource: null })], fulfilment: 'recoger', snapshot: snap(), maxEur: null })
    expect(nextRedMax(p({ maxEur: 5 }), 'recoger', unpriced)).toEqual({ maxEur: 5 })
  })
  it('changing what is ordered brings it back to the computed one', () => {
    const changes: OrderPatch[] = [
      { lines: [{ key: 'l1', quantity: 2000 }] },
      { lines: [{ key: 'l1', remove: true }] },
      { lines: [{ key: 'l1', moveToShopId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d' }] },
      { lines: [{ key: 'l1', choice: 'golden' }] },
      { lines: [{ key: 'l1', include: false }] },
      { lines: [{ key: 'l1', note: 'maduras', quantity: 1500 }] },
      { add: [{ name: 'peras' }] },
    ]
    for (const c of changes) expect(nextRedMax(c, 'recoger', view), JSON.stringify(c)).toEqual({ maxEur: null })
  })
  it('switching pickup ↔ delivery brings it back; sending the same one keeps it', () => {
    expect(nextRedMax(p({ fulfilment: 'domicilio' }), 'recoger', view)).toEqual({ maxEur: null })
    expect(nextRedMax(p({ fulfilment: 'recoger' }), 'domicilio', view)).toEqual({ maxEur: null })
    expect(nextRedMax(p({ fulfilment: 'recoger' }), 'recoger', view)).toEqual({ maxEur: undefined })
  })
  it('a note, the address or the cap alone keep the max', () => {
    expect(nextRedMax(p({ lines: [{ key: 'l1', note: 'maduras' }] }), 'recoger', view)).toEqual({ maxEur: undefined })
    expect(nextRedMax(p({ lines: [{ key: 'l1', note: null, quantity: undefined }] }), 'recoger', view)).toEqual({ maxEur: undefined })
    expect(nextRedMax(p({ address: 'Calle de prueba 1' }), 'domicilio', view)).toEqual({ maxEur: undefined })
    expect(nextRedMax(p({ capEur: 40 }), 'recoger', view)).toEqual({ maxEur: undefined })
  })
})

describe('draftableShops («Preparar» with the Red off or failed)', () => {
  const own = { id: 'own', origin: 'propia', redShopId: null }
  const joined = { id: 'joined', origin: 'propia', redShopId: 'r1' }
  const copy = { id: 'copy', origin: 'red', redShopId: 'r2' }
  const shops = [own, joined, copy]
  it('Red on and its step worked: every shop, Red copies included', () => {
    expect(draftableShops(shops, { redOn: true, redFailed: false }).map((s) => s.id)).toEqual(['own', 'joined', 'copy'])
  })
  it('the switch turned off: Red copies are left out (never a plain WhatsApp order to the Red shop); an own shop linked to the Red stays', () => {
    expect(draftableShops(shops, { redOn: false, redFailed: false }).map((s) => s.id)).toEqual(['own', 'joined'])
  })
  it('the Red step failed: the same', () => {
    expect(draftableShops(shops, { redOn: true, redFailed: true }).map((s) => s.id)).toEqual(['own', 'joined'])
  })
})

describe('keepsRedLink (editing an own shop linked to the Red)', () => {
  const current = { whatsapp: '34600000091', kind: 'fruteria' }
  it('the same WhatsApp and kind (or not sent) keep the link', () => {
    expect(keepsRedLink(current, {})).toBe(true)
    expect(keepsRedLink(current, { whatsapp: '34600000091', kind: 'fruteria' })).toBe(true)
  })
  it('another WhatsApp, no WhatsApp or another kind unlink it', () => {
    expect(keepsRedLink(current, { whatsapp: '34600000099' })).toBe(false)
    expect(keepsRedLink(current, { whatsapp: null })).toBe(false)
    expect(keepsRedLink(current, { kind: 'supermercado' })).toBe(false)
  })
})
