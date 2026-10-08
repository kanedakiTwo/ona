/**
 * "Compra en mis tiendas" chat skills (shopOrderSkills.ts) against a fake
 * AppApi: exact endpoints and bodies, the short links relayed verbatim,
 * and the guard rails (no POST when the target order is ambiguous or
 * missing). Plus the form ↔ schema contract for both shop payload builders.
 *
 * Run: pnpm --filter @ona/api test src/tests/shopOrderSkills.test.ts
 */
import { describe, it, expect } from 'vitest'
import { EMPTY_SHOP_FORM, buildShopPayload, shopInputSchema, type Shop, type ShopOrder } from '@ona/shared'
import { shopOrderSkills, payloadFrom } from '../services/assistant/shopOrderSkills.js'
import type { AppApi } from '../services/assistant/appApi.js'

const get = (name: string) => {
  const s = shopOrderSkills.find((x) => x.name === name)
  if (!s) throw new Error(`skill ${name} missing`)
  return s
}

function fakeApi(routes: Record<string, unknown | ((body: any) => unknown)> = {}) {
  const calls: { method: string; path: string; body?: any }[] = []
  const api: AppApi = async (method, path, body) => {
    calls.push({ method, path, body })
    const key = `${method} ${path}`
    for (const [pattern, value] of Object.entries(routes)) {
      if (pattern === key || (pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1)))) {
        return (typeof value === 'function' ? (value as any)(body) : value) as any
      }
    }
    return {} as any
  }
  return { api, calls }
}
const ctx = (api: AppApi) => ({ userId: 'u1', db: null, api })
const writes = (calls: { method: string }[]) => calls.filter((c) => c.method !== 'GET')

const SHOP: Shop = {
  deliveryMinEur: null,
  deliveryFeeEur: null,
  id: 's1',
  householdId: 'h1',
  name: 'The Fruits of the World',
  kind: 'fruteria',
  channel: 'whatsapp',
  whatsapp: '34913525111',
  email: null,
  webUrl: null,
  phone: null,
  customerName: 'Miguel',
  fulfilment: 'recoger',
  address: null,
  notes: null,
  position: 0,
  createdAt: '2026-10-07T00:00:00Z',
}

function order(over: Partial<ShopOrder> = {}): ShopOrder {
  return {
    id: 'o1',
    shopId: 's1',
    shop: { name: 'The Fruits of the World', kind: 'fruteria', channel: 'whatsapp', whatsapp: '34913525111', email: null, webUrl: null, phone: null },
    status: 'sent',
    lines: [
      { key: 'l1', sourceItemId: 'a', ingredientId: 'a', name: 'tomate', quantity: 1000, unit: 'g', note: null, estimateEur: 2.3, estimateSource: 'referencia', volatile: false, quote: null, verdict: null, reasons: [], decision: null },
      { key: 'l2', sourceItemId: 'b', ingredientId: 'b', name: 'brocoli', quantity: 250, unit: 'g', note: null, estimateEur: 0.6, estimateSource: 'referencia', volatile: false, quote: null, verdict: null, reasons: [], decision: null },
    ],
    estimateEur: 2.9,
    capEur: null,
    messageText: 'Hola, soy Miguel.',
    shopReplyText: null,
    quoteSummary: null,
    confirmationText: null,
    finalTotalEur: null,
    links: { order: 'https://wa.me/34913525111?text=Hola', confirmation: null, shortOrder: 'https://ona.app/c/AAAAAAAAAAAAAAAA', shortConfirmation: null, tooLong: false },
    fulfilment: 'recoger',
    address: null,
    blockers: [],
    delivery: null,
    searchLinks: {},
    createdAt: '2026-10-07T00:00:00Z',
    sentAt: null,
    quotedAt: null,
    approvedAt: null,
    closedAt: null,
    ...over,
  }
}

describe('prepare_shop_orders', () => {
  it('without shops: asks for them and points at /compra/tiendas', async () => {
    const { api } = fakeApi({ 'POST /shop-orders/prepare': { orders: [], unassigned: [], skipped: [], hasShops: false } })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.data.navigateTo).toBe('/compra/tiendas')
    expect(r.summary).toMatch(/manage_shops/)
  })

  it('returns one short link per messaging shop and a web checklist hint', async () => {
    const web = order({ id: 'o2', shop: { name: 'El Corte Inglés', kind: 'supermercado', channel: 'web', whatsapp: null, email: null, webUrl: 'https://www.elcorteingles.es/supermercado/', phone: null }, links: { order: 'https://www.elcorteingles.es/supermercado/', confirmation: null, shortOrder: null, shortConfirmation: null, tooLong: false } })
    const { api, calls } = fakeApi({
      'POST /shop-orders/prepare': { orders: [order({ status: 'draft' }), web], unassigned: [], skipped: [{ name: 'sal' }], hasShops: true },
    })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(writes(calls)).toEqual([{ method: 'POST', path: '/shop-orders/prepare', body: {} }])
    expect(r.summary).toContain('https://ona.app/c/AAAAAAAAAAAAAAAA')
    expect(r.summary).toMatch(/El Corte Inglés.*web/)
    expect(r.summary).toContain('sal')
    expect(r.data.navigateTo).toBe('/compra')
  })
})

describe('register_shop_reply', () => {
  it('sends the literal text to the only order waiting for a reply and reports the lines', async () => {
    const quoted = order({
      status: 'quoted',
      lines: [
        { ...order().lines[0], quote: { status: 'ok', quantityText: null, pricePerKg: 2.5, lineTotal: 2.5, substitute: null, comment: null }, verdict: 'ok', decision: 'keep' },
        { ...order().lines[1], quote: { status: 'sustituto', quantityText: null, pricePerKg: null, lineTotal: null, substitute: 'romanesco', comment: null }, verdict: 'revisar', reasons: ['Propone romanesco en su lugar.'] },
      ],
      quoteSummary: { totalEur: 6, pickupText: 'mañana a las 11', paymentText: 'bizum', notes: null, overCap: false, needsDecision: true },
    })
    const { api, calls } = fakeApi({ 'GET /shop-orders': [order()], 'POST /shop-orders/o1/quote': quoted })
    const r = await get('register_shop_reply').handler({ text: 'Tomate ok, brócoli no, te pongo romanesco' }, ctx(api))
    expect(writes(calls)).toEqual([{ method: 'POST', path: '/shop-orders/o1/quote', body: { text: 'Tomate ok, brócoli no, te pongo romanesco' } }])
    expect(r.summary).toContain('Propone romanesco')
    expect(r.summary).toContain('mañana a las 11')
    expect(r.summary).toContain('[[opciones:')
  })

  it('does nothing when it cannot tell which shop answered', async () => {
    const { api, calls } = fakeApi({ 'GET /shop-orders': [order(), order({ id: 'o2', shop: { ...order().shop, name: 'Ben-Car' } })] })
    const r = await get('register_shop_reply').handler({ text: 'todo ok' }, ctx(api))
    expect(writes(calls)).toEqual([])
    expect(r.summary).toMatch(/varios pedidos/)
  })

  it('uses the shop name when given', async () => {
    const { api, calls } = fakeApi({ 'GET /shop-orders': [order(), order({ id: 'o2', shop: { ...order().shop, name: 'Ben-Car' } })], 'POST /shop-orders/o2/quote': order({ id: 'o2', status: 'quoted', quoteSummary: { totalEur: 10, pickupText: null, paymentText: null, notes: null, overCap: false, needsDecision: false } }) })
    await get('register_shop_reply').handler({ text: 'todo ok', shop: 'ben car' }, ctx(api))
    expect(writes(calls)[0].path).toBe('/shop-orders/o2/quote')
  })
})

describe('approve_shop_order', () => {
  it('maps the names to remove onto line keys and relays the confirmation link', async () => {
    const quoted = order({ status: 'quoted' })
    const approved = order({ status: 'approved', confirmationText: 'Perfecto, adelante con el pedido.\nQuita: brócoli.', links: { ...order().links, shortConfirmation: 'https://ona.app/c/AAAAAAAAAAAAAAAA?m=ok' } })
    const { api, calls } = fakeApi({ 'GET /shop-orders': [quoted], 'POST /shop-orders/o1/approve': approved })
    const r = await get('approve_shop_order').handler({ remove: ['brócoli'] }, ctx(api))
    expect(writes(calls)).toEqual([{ method: 'POST', path: '/shop-orders/o1/approve', body: { decisions: { l2: 'remove' } } }])
    expect(r.summary).toContain('https://ona.app/c/AAAAAAAAAAAAAAAA?m=ok')
  })

  it('refuses when no shop has answered yet', async () => {
    const { api, calls } = fakeApi({ 'GET /shop-orders': [order({ status: 'sent' })] })
    const r = await get('approve_shop_order').handler({}, ctx(api))
    expect(writes(calls)).toEqual([])
    expect(r.summary).toMatch(/No hay ningún pedido con respuesta/)
  })
})

describe('close_shop_order', () => {
  it('cancels or closes the open order', async () => {
    const a = fakeApi({ 'GET /shop-orders': [order({ status: 'approved' })] })
    await get('close_shop_order').handler({ cancel: true }, ctx(a.api))
    expect(writes(a.calls)).toEqual([{ method: 'POST', path: '/shop-orders/o1/cancel', body: undefined }])
    const b = fakeApi({ 'GET /shop-orders': [order({ status: 'approved' })] })
    await get('close_shop_order').handler({ totalEur: 23.4 }, ctx(b.api))
    expect(writes(b.calls)).toEqual([{ method: 'POST', path: '/shop-orders/o1/close', body: { finalTotalEur: 23.4 } }])
  })
})

describe('manage_shops', () => {
  it('adds a shop: channel from the contact given, Spanish number gets +34', async () => {
    const { api, calls } = fakeApi({ 'GET /shops': [], 'POST /shops': (b: any) => ({ ...SHOP, ...b }) })
    await get('manage_shops').handler({ action: 'add', name: 'Ben-Car Boadilla', kind: 'carniceria', whatsapp: '638 015 827', customerName: 'Miguel' }, ctx(api))
    const body = writes(calls)[0].body
    expect(body).toMatchObject({ name: 'Ben-Car Boadilla', kind: 'carniceria', channel: 'whatsapp', whatsapp: '34638015827', fulfilment: 'recoger' })
  })

  it('will not add a shop without any contact', async () => {
    const { api, calls } = fakeApi({ 'GET /shops': [] })
    const r = await get('manage_shops').handler({ action: 'add', name: 'Pescados Aparicio', kind: 'pescaderia' }, ctx(api))
    expect(writes(calls)).toEqual([])
    expect(r.summary).toMatch(/Falta un contacto/)
  })

  it('updates by fuzzy name, keeping the fields it was not told about', async () => {
    const { api, calls } = fakeApi({ 'GET /shops': [SHOP] })
    await get('manage_shops').handler({ action: 'update', name: 'fruits', delivery: 'domicilio', address: 'C/ Real 1, Pozuelo' }, ctx(api))
    expect(writes(calls)[0]).toMatchObject({ method: 'PATCH', path: '/shops/s1' })
    expect(writes(calls)[0].body).toMatchObject({ name: SHOP.name, channel: 'whatsapp', whatsapp: '34913525111', customerName: 'Miguel', fulfilment: 'domicilio', address: 'C/ Real 1, Pozuelo' })
  })
})

describe('shop payload ↔ shopInputSchema contract', () => {
  it('the web form payload passes the API schema', () => {
    const payload = buildShopPayload({ ...EMPTY_SHOP_FORM, name: ' The Fruits of the World ', whatsapp: '+34 913 52 51 11', customerName: 'Miguel' })
    const parsed = shopInputSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    expect(payload.whatsapp).toBe('34913525111')
    expect(payload.email).toBeNull()
  })
  it('the web form for a web shop with a bare domain passes', () => {
    const payload = buildShopPayload({ ...EMPTY_SHOP_FORM, name: 'El Corte Inglés', kind: 'supermercado', channel: 'web', webUrl: 'www.elcorteingles.es/supermercado/' })
    expect(shopInputSchema.safeParse(payload).success).toBe(true)
    expect(payload.webUrl).toBe('https://www.elcorteingles.es/supermercado/')
  })
  it('the form surfaces a missing contact / address as a schema error', () => {
    expect(shopInputSchema.safeParse(buildShopPayload({ ...EMPTY_SHOP_FORM, name: 'X' })).success).toBe(false)
    expect(shopInputSchema.safeParse(buildShopPayload({ ...EMPTY_SHOP_FORM, name: 'X', whatsapp: '600000000', fulfilment: 'domicilio' })).success).toBe(false)
  })
  it('the chat skill payload passes the API schema (add and update)', () => {
    expect(shopInputSchema.safeParse(payloadFrom({ name: 'Ben-Car', kind: 'carniceria', whatsapp: '638015827' }, null)).success).toBe(true)
    expect(shopInputSchema.safeParse(payloadFrom({ name: 'ECI', kind: 'supermercado', web: 'elcorteingles.es/supermercado' }, null)).success).toBe(true)
    expect(shopInputSchema.safeParse(payloadFrom({ name: 'fruits', notes: 'Cierra a las 14:00' }, SHOP)).success).toBe(true)
  })
})

describe('edit_shop_order', () => {
  const fru = order({ id: 'of', status: 'draft' })
  const sup = order({ id: 'os', status: 'draft', shop: { name: 'El Corte Inglés', kind: 'supermercado', channel: 'web', whatsapp: null, email: null, webUrl: 'https://www.elcorteingles.es/supermercado/', phone: null } })
  const car = order({
    id: 'oc',
    status: 'draft',
    shop: { name: 'Ben-Car', kind: 'carniceria', channel: 'whatsapp', whatsapp: '34638015827', email: null, webUrl: null, phone: null },
    lines: [{ ...order().lines[0], key: 'l1', name: 'jamon', text: '100 g de jamón, loncheado fino — ¿serrano o ibérico?', ruleKey: 'jamon' }],
  })

  it('routes each added product to its shop and keeps the same link', async () => {
    const { api, calls } = fakeApi({ 'GET /shop-orders': [fru, sup, car], 'PATCH *': (b: any) => ({ ...fru, ...b }) })
    const r = await get('edit_shop_order').handler({ add: [{ name: 'manzanas', quantity: 1, unit: 'kg' }, { name: 'detergente' }] }, ctx(api))
    expect(writes(calls)).toEqual([
      { method: 'PATCH', path: '/shop-orders/of', body: { add: [{ name: 'manzanas', quantity: 1000, unit: 'g' }] } },
      { method: 'PATCH', path: '/shop-orders/os', body: { add: [{ name: 'detergente' }] } },
    ])
    expect(r.summary).toMatch(/enlaces son los mismos/)
  })

  it('answers a pending choice and switches to home delivery with the address', async () => {
    const { api, calls } = fakeApi({ 'GET /shop-orders': [fru, car], 'PATCH *': (b: any) => ({ ...car, ...b }) })
    await get('edit_shop_order').handler({ choose: [{ item: 'jamón', option: 'serrano' }], shop: 'ben car', delivery: 'domicilio', address: 'C/ Real 1, Boadilla' }, ctx(api))
    expect(writes(calls)).toEqual([
      { method: 'PATCH', path: '/shop-orders/oc', body: { lines: [{ key: 'l1', choice: 'serrano' }], fulfilment: 'domicilio', address: 'C/ Real 1, Boadilla' } },
    ])
  })

  it('does nothing without a prepared order', async () => {
    const { api, calls } = fakeApi({ 'GET /shop-orders': [order({ status: 'sent' })] })
    const r = await get('edit_shop_order').handler({ add: [{ name: 'manzanas' }] }, ctx(api))
    expect(writes(calls)).toEqual([])
    expect(r.summary).toMatch(/No hay pedidos preparados/)
  })
})
