/**
 * "Compra en mis tiendas" chat skills (shopOrderSkills.ts) against a fake
 * AppApi: exact endpoints and bodies, the short links relayed verbatim,
 * and the guard rails (no POST when the target order is ambiguous or
 * missing). Plus the form ↔ schema contract for both shop payload builders.
 *
 * Run: pnpm --filter @ona/api test src/tests/shopOrderSkills.test.ts
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_RED_SETTINGS, EMPTY_SHOP_FORM, buildShopPayload, shopInputSchema, type RedOrderView, type Shop, type ShopOrder } from '@ona/shared'
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
  name: 'Frutería del barrio',
  kind: 'fruteria',
  channel: 'whatsapp',
  whatsapp: '34600000001',
  email: null,
  webUrl: null,
  phone: null,
  customerName: 'Ana',
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
    shop: { name: 'Frutería del barrio', kind: 'fruteria', channel: 'whatsapp', whatsapp: '34600000001', email: null, webUrl: null, phone: null },
    status: 'sent',
    lines: [
      { key: 'l1', sourceItemId: 'a', ingredientId: 'a', name: 'tomate', quantity: 1000, unit: 'g', note: null, estimateEur: 2.3, estimateSource: 'referencia', volatile: false, quote: null, verdict: null, reasons: [], decision: null },
      { key: 'l2', sourceItemId: 'b', ingredientId: 'b', name: 'brocoli', quantity: 250, unit: 'g', note: null, estimateEur: 0.6, estimateSource: 'referencia', volatile: false, quote: null, verdict: null, reasons: [], decision: null },
    ],
    estimateEur: 2.9,
    capEur: null,
    messageText: 'Hola, soy Ana.',
    shopReplyText: null,
    quoteSummary: null,
    confirmationText: null,
    finalTotalEur: null,
    links: { order: 'https://wa.me/34600000001?text=Hola', confirmation: null, shortOrder: 'https://ona.app/c/AAAAAAAAAAAAAAAA', shortConfirmation: null, tooLong: false },
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

/** A Red order's view (RedOrderView): −5 %, ≈17,10 €, como mucho 20 €. */
const RED_VIEW: RedOrderView = { redShopId: 'r1', terms: DEFAULT_RED_SETTINGS, estimateShopEur: 18, estimateEur: 17.1, feeEur: null, ceilingShopEur: 20.7, maxEur: 20, maxRaised: false, shopCeilingEur: 21.05, delivers: false, ownShopJoined: false }
const RED_LINKS = { order: null, confirmation: null, shortOrder: 'https://ona.app/c/REDREDREDREDRED1', shortConfirmation: null, tooLong: false, view: 'https://ona.app/compra?pedido=o9' }

describe('prepare_shop_orders', () => {
  it('without shops: asks for them and points at /compra/tiendas', async () => {
    const { api } = fakeApi({ 'POST /shop-orders/prepare': { orders: [], unassigned: [], skipped: [], hasShops: false } })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.data.navigateTo).toBe('/compra/tiendas')
    expect(r.summary).toMatch(/manage_shops/)
  })

  it('returns one short link per messaging shop and a web checklist hint', async () => {
    const web = order({ id: 'o2', shop: { name: 'Súper Online', kind: 'supermercado', channel: 'web', whatsapp: null, email: null, webUrl: 'https://www.tutienda.es/', phone: null }, links: { order: 'https://www.tutienda.es/', confirmation: null, shortOrder: null, shortConfirmation: null, tooLong: false } })
    const { api, calls } = fakeApi({
      'POST /shop-orders/prepare': { orders: [order({ status: 'draft' }), web], unassigned: [], skipped: [{ name: 'sal' }], hasShops: true },
    })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(writes(calls)).toEqual([{ method: 'POST', path: '/shop-orders/prepare', body: {} }])
    expect(r.summary).toContain('https://ona.app/c/AAAAAAAAAAAAAAAA')
    expect(r.summary).toMatch(/Súper Online.*web/)
    expect(r.summary).toContain('sal')
    expect(r.data.navigateTo).toBe('/compra')
  })

  it('a Red order: its /c/ link to the card on /compra, the discount and the max, never «envíaselo desde tu WhatsApp»', async () => {
    const red = order({
      id: 'o9',
      status: 'draft',
      shop: { name: 'Frutería de prueba', kind: 'fruteria', channel: 'whatsapp', whatsapp: '34600000091', email: null, webUrl: null, phone: null },
      links: RED_LINKS,
      red: RED_VIEW,
    })
    const { api } = fakeApi({ 'POST /shop-orders/prepare': { orders: [red], unassigned: [], skipped: [], hasShops: true, red: { enabled: true, discountPct: 5, needsPostalCode: false, questions: [], assigned: [], heldBack: [], uncovered: [] } } })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.summary).toContain('https://ona.app/c/REDREDREDREDRED1')
    expect(r.summary).toMatch(/de la Red, −5 % ya descontado/)
    expect(r.summary).toMatch(/como mucho 20 €/)
    expect(r.summary).not.toMatch(/envíaselo desde tu WhatsApp/)
    expect(r.summary).not.toMatch(/wa\.me/)
    expect(r.summary).toMatch(/REDREDREDREDRED1(\s|$)/)
  })

  it('a Red order with something missing: still its link, nothing glued to it, and what is missing', async () => {
    const red = order({ id: 'o9', status: 'draft', links: RED_LINKS, red: RED_VIEW, blockers: ['Falta la dirección de entrega'] })
    const { api } = fakeApi({ 'POST /shop-orders/prepare': { orders: [red], unassigned: [], skipped: [], hasShops: true, red: { enabled: true, discountPct: 5, needsPostalCode: false, questions: [], assigned: [], heldBack: [], uncovered: [] } } })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.summary).toMatch(/REDREDREDREDRED1 \(antes de pedirlo falta: Falta la dirección de entrega\)/)
  })

  it('Red without a postal code and no shops: asks for the postal code in the app, not for shops', async () => {
    const { api } = fakeApi({ 'POST /shop-orders/prepare': { orders: [], unassigned: [{ name: 'manzanas' }], skipped: [], hasShops: false, red: { enabled: true, discountPct: 5, needsPostalCode: true, questions: [], assigned: [], heldBack: [], uncovered: [] } } })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.data.navigateTo).toBe('/compra')
    expect(r.summary).toMatch(/código postal/)
    expect(r.summary).not.toMatch(/manage_shops/)
  })

  it('Red on, postal code given, no shops and no Red shop nearby: still asks for shops (not «nada pendiente»)', async () => {
    const { api } = fakeApi({ 'POST /shop-orders/prepare': { orders: [], unassigned: [{ name: 'manzanas' }], skipped: [], hasShops: false, red: { enabled: true, discountPct: 5, needsPostalCode: false, questions: [], assigned: [], heldBack: [], uncovered: ['fruteria'] } } })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.data.navigateTo).toBe('/compra/tiendas')
    expect(r.summary).toMatch(/manage_shops/)
  })

  it('Red: tells what can be picked in the app (Red shop or súper), which Red shop it assigned, and what it held back', async () => {
    const red = order({ id: 'o9', status: 'draft', links: RED_LINKS, red: RED_VIEW })
    const { api } = fakeApi({
      'POST /shop-orders/prepare': {
        orders: [red],
        unassigned: [],
        skipped: [],
        hasShops: true,
        red: {
          enabled: true,
          discountPct: 5,
          needsPostalCode: false,
          questions: [{ kind: 'carniceria', redShop: { id: 'r2', name: 'Carnicería de prueba' }, superName: 'Súper Online' }],
          assigned: [{ kind: 'fruteria', shopId: 's9', name: 'Frutería de prueba', alternatives: [] }],
          heldBack: [{ kind: 'pescaderia', reason: 'alergias', candidates: [{ id: 'r3', name: 'Pescadería de prueba' }] }],
          uncovered: [],
        },
      },
    })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.summary).toMatch(/Dile que puede elegir en la app \(Compra\) si lo de carnicería lo pide a Carnicería de prueba \(de la Red, −5 %\) o lo sigue pidiendo en Súper Online/)
    expect(r.summary).not.toMatch(/una sola vez/)
    expect(r.summary).toMatch(/Le he asignado una tienda de la Red: Frutería de prueba \(frutería, −5 %\)/)
    expect(r.summary).toMatch(/Por las alergias de casa no le he asignado sola una pescadería de la Red; puede elegirla en la app/)
  })

  it('only Red orders: the Red instruction, none of the WhatsApp reply / edit flow', async () => {
    const red = order({ id: 'o9', status: 'draft', links: RED_LINKS, red: RED_VIEW })
    const { api } = fakeApi({ 'POST /shop-orders/prepare': { orders: [red], unassigned: [], skipped: [], hasShops: true, red: { enabled: true, discountPct: 5, needsPostalCode: false, questions: [], assigned: [], heldBack: [], uncovered: [] } } })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.summary).toMatch(/Para las de la Red: UNA línea por tienda con su enlace copiado TAL CUAL/)
    expect(r.summary).toMatch(/No se envían por WhatsApp/)
    expect(r.summary).not.toMatch(/antes de enviarlo falta/)
    expect(r.summary).not.toMatch(/Cuando la tienda conteste/)
    expect(r.summary).toMatch(/si quiere añadir algo más/)
  })

  it('Red and own shops together: both instructions, each for its own orders', async () => {
    const red = order({ id: 'o9', status: 'draft', links: RED_LINKS, red: RED_VIEW })
    const { api } = fakeApi({ 'POST /shop-orders/prepare': { orders: [red, order({ status: 'draft' })], unassigned: [], skipped: [], hasShops: true, red: { enabled: true, discountPct: 5, needsPostalCode: false, questions: [], assigned: [], heldBack: [], uncovered: [] } } })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.summary).toMatch(/Para las de la Red: UNA línea/)
    expect(r.summary).toMatch(/Para las demás, UNA línea por tienda: .*"antes de enviarlo falta"/)
    expect(r.summary).toMatch(/Cuando la tienda conteste, que te reenvíe/)
  })

  it('no Red orders: the WhatsApp instruction exactly as before', async () => {
    const { api } = fakeApi({ 'POST /shop-orders/prepare': { orders: [order({ status: 'draft' })], unassigned: [], skipped: [], hasShops: true } })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.summary).toContain(
      'Responde con UNA línea por tienda: las que están listas con su enlace copiado TAL CUAL; las que tienen "antes de enviarlo falta", con esa pregunta (corta) — luego se aplica con edit_shop_order, sin volver a preparar. Termina preguntando si quiere añadir algo más (por ejemplo fruta para la semana): se añade con edit_shop_order y el enlace sigue siendo el mismo. Cuando la tienda conteste, que te reenvíe o pegue su respuesta y la reviso.',
    )
    expect(r.summary).not.toMatch(/de la Red/)
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
    const { api, calls } = fakeApi({ 'GET /shop-orders': [order(), order({ id: 'o2', shop: { ...order().shop, name: 'Carnicería La Plaza' } })] })
    const r = await get('register_shop_reply').handler({ text: 'todo ok' }, ctx(api))
    expect(writes(calls)).toEqual([])
    expect(r.summary).toMatch(/varios pedidos/)
  })

  it('uses the shop name when given', async () => {
    const { api, calls } = fakeApi({ 'GET /shop-orders': [order(), order({ id: 'o2', shop: { ...order().shop, name: 'Carnicería La Plaza' } })], 'POST /shop-orders/o2/quote': order({ id: 'o2', status: 'quoted', quoteSummary: { totalEur: 10, pickupText: null, paymentText: null, notes: null, overCap: false, needsDecision: false } }) })
    await get('register_shop_reply').handler({ text: 'todo ok', shop: 'la plaza' }, ctx(api))
    expect(writes(calls)[0].path).toBe('/shop-orders/o2/quote')
  })

  it('never registers a forwarded reply on a Red order', async () => {
    const red = order({ id: 'o9', status: 'draft', red: RED_VIEW })
    const { api, calls } = fakeApi({ 'GET /shop-orders': [red] })
    await get('register_shop_reply').handler({ text: 'todo ok' }, ctx(api))
    expect(calls.some((c) => c.path.endsWith('/quote'))).toBe(false)
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

  it('skips Red orders: confirms the own shop that answered, never a Red one', async () => {
    const red = order({ id: 'o9', status: 'quoted', red: RED_VIEW })
    const { api, calls } = fakeApi({ 'GET /shop-orders': [red, order({ status: 'quoted' })], 'POST /shop-orders/o1/approve': order({ status: 'approved' }) })
    await get('approve_shop_order').handler({}, ctx(api))
    expect(writes(calls)).toEqual([{ method: 'POST', path: '/shop-orders/o1/approve', body: { decisions: {} } }])
    const b = fakeApi({ 'GET /shop-orders': [red] })
    const r = await get('approve_shop_order').handler({}, ctx(b.api))
    expect(writes(b.calls)).toEqual([])
    expect(r.summary).toMatch(/No hay ningún pedido con respuesta/)
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

  it('cancels a Red order the shop hasn\'t started (ordered / accepted)', async () => {
    const a = fakeApi({ 'GET /shop-orders': [order({ id: 'o9', status: 'ordered', red: RED_VIEW })] })
    await get('close_shop_order').handler({ cancel: true }, ctx(a.api))
    expect(writes(a.calls)).toEqual([{ method: 'POST', path: '/shop-orders/o9/cancel', body: undefined }])
    const b = fakeApi({ 'GET /shop-orders': [order({ id: 'o9', status: 'accepted', red: RED_VIEW })] })
    await get('close_shop_order').handler({ cancel: true }, ctx(b.api))
    expect(writes(b.calls)).toEqual([{ method: 'POST', path: '/shop-orders/o9/cancel', body: undefined }])
  })

  it('never closes a Red order by hand: it closes the other one, or says the Red ones close on their own', async () => {
    const red = order({ id: 'o9', status: 'draft', red: RED_VIEW })
    const a = fakeApi({ 'GET /shop-orders': [red, order({ status: 'approved' })] })
    await get('close_shop_order').handler({}, ctx(a.api))
    expect(writes(a.calls)).toEqual([{ method: 'POST', path: '/shop-orders/o1/close', body: {} }])
    const b = fakeApi({ 'GET /shop-orders': [red] })
    const r = await get('close_shop_order').handler({}, ctx(b.api))
    expect(writes(b.calls)).toEqual([])
    expect(r.summary).toMatch(/se cierran solos/)
  })

  it('a Red order the shop is already preparing: no cancel call, says to talk to the shop', async () => {
    const { api, calls } = fakeApi({ 'GET /shop-orders': [order({ id: 'o9', status: 'preparing', red: RED_VIEW })] })
    const r = await get('close_shop_order').handler({ cancel: true }, ctx(api))
    expect(writes(calls)).toEqual([])
    expect(r.summary).toMatch(/hable con la tienda/)
  })
})

describe('manage_shops', () => {
  it('adds a shop: channel from the contact given, Spanish number gets +34', async () => {
    const { api, calls } = fakeApi({ 'GET /shops': [], 'POST /shops': (b: any) => ({ ...SHOP, ...b }) })
    await get('manage_shops').handler({ action: 'add', name: 'Carnicería La Plaza', kind: 'carniceria', whatsapp: '600 000 002', customerName: 'Ana' }, ctx(api))
    const body = writes(calls)[0].body
    expect(body).toMatchObject({ name: 'Carnicería La Plaza', kind: 'carniceria', channel: 'whatsapp', whatsapp: '34600000002', fulfilment: 'recoger' })
  })

  it('will not add a shop without any contact', async () => {
    const { api, calls } = fakeApi({ 'GET /shops': [] })
    const r = await get('manage_shops').handler({ action: 'add', name: 'Pescados Aparicio', kind: 'pescaderia' }, ctx(api))
    expect(writes(calls)).toEqual([])
    expect(r.summary).toMatch(/Falta un contacto/)
  })

  it('updates by fuzzy name, keeping the fields it was not told about', async () => {
    const { api, calls } = fakeApi({ 'GET /shops': [SHOP] })
    await get('manage_shops').handler({ action: 'update', name: 'barrio', delivery: 'domicilio', address: 'C/ Mayor 1, 2.º B' }, ctx(api))
    expect(writes(calls)[0]).toMatchObject({ method: 'PATCH', path: '/shops/s1' })
    expect(writes(calls)[0].body).toMatchObject({ name: SHOP.name, channel: 'whatsapp', whatsapp: '34600000001', customerName: 'Ana', fulfilment: 'domicilio', address: 'C/ Mayor 1, 2.º B' })
  })
})

describe('manage_shops move (PRO-287)', () => {
  const ECI: Shop = { ...SHOP, id: 's2', name: 'El Corte Inglés', kind: 'supermercado', channel: 'web', whatsapp: null, webUrl: 'https://www.elcorteingles.es', position: 1 }
  const MERCADONA: Shop = { ...SHOP, id: 's3', name: 'Mercadona', kind: 'supermercado', channel: 'web', whatsapp: null, webUrl: 'https://tienda.mercadona.es', position: 2 }

  it('«pon Mercadona como primer súper» → PATCH /shops/:id with move: first, and says who gets the order', async () => {
    const { api, calls } = fakeApi({ 'GET /shops': [SHOP, ECI, MERCADONA], 'PATCH /shops/s3': [SHOP, { ...MERCADONA, position: 1 }, { ...ECI, position: 2 }] })
    const r = await get('manage_shops').handler({ action: 'move', name: 'mercadona', to: 'first' }, ctx(api))
    expect(writes(calls)).toEqual([{ method: 'PATCH', path: '/shops/s3', body: { move: 'first' } }])
    expect(r.summary).toMatch(/1\. Mercadona, 2\. El Corte Inglés/)
    expect(r.summary).toMatch(/va a Mercadona/)
  })

  it('up / down pass through; anything else means first', async () => {
    const { api, calls } = fakeApi({ 'GET /shops': [SHOP, ECI, MERCADONA], 'PATCH /shops/*': [SHOP, ECI, MERCADONA] })
    await get('manage_shops').handler({ action: 'move', name: 'corte ingles', to: 'down' }, ctx(api))
    await get('manage_shops').handler({ action: 'move', name: 'mercadona' }, ctx(api))
    expect(writes(calls).map((c) => c.body)).toEqual([{ move: 'down' }, { move: 'first' }])
  })
})

describe('shop payload ↔ shopInputSchema contract', () => {
  it('the web form payload passes the API schema', () => {
    const payload = buildShopPayload({ ...EMPTY_SHOP_FORM, name: ' Frutería del barrio ', whatsapp: '+34 600 00 00 01', customerName: 'Ana' })
    const parsed = shopInputSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    expect(payload.whatsapp).toBe('34600000001')
    expect(payload.email).toBeNull()
  })
  it('the web form for a web shop with a bare domain passes', () => {
    const payload = buildShopPayload({ ...EMPTY_SHOP_FORM, name: 'Súper Online', kind: 'supermercado', channel: 'web', webUrl: 'www.tutienda.es/' })
    expect(shopInputSchema.safeParse(payload).success).toBe(true)
    expect(payload.webUrl).toBe('https://www.tutienda.es/')
  })
  it('the form surfaces a missing contact / address as a schema error', () => {
    expect(shopInputSchema.safeParse(buildShopPayload({ ...EMPTY_SHOP_FORM, name: 'X' })).success).toBe(false)
    expect(shopInputSchema.safeParse(buildShopPayload({ ...EMPTY_SHOP_FORM, name: 'X', whatsapp: '600000000', fulfilment: 'domicilio' })).success).toBe(false)
  })
  it('the chat skill payload passes the API schema (add and update)', () => {
    expect(shopInputSchema.safeParse(payloadFrom({ name: 'Carnicería La Plaza', kind: 'carniceria', whatsapp: '600000002' }, null)).success).toBe(true)
    expect(shopInputSchema.safeParse(payloadFrom({ name: 'Súper Online', kind: 'supermercado', web: 'tutienda.es' }, null)).success).toBe(true)
    expect(shopInputSchema.safeParse(payloadFrom({ name: 'barrio', notes: 'Cierra a las 14:00' }, SHOP)).success).toBe(true)
  })
})

describe('edit_shop_order', () => {
  const fru = order({ id: 'of', status: 'draft' })
  const sup = order({ id: 'os', status: 'draft', shop: { name: 'Súper Online', kind: 'supermercado', channel: 'web', whatsapp: null, email: null, webUrl: 'https://www.tutienda.es/', phone: null } })
  const car = order({
    id: 'oc',
    status: 'draft',
    shop: { name: 'Carnicería La Plaza', kind: 'carniceria', channel: 'whatsapp', whatsapp: '34600000002', email: null, webUrl: null, phone: null },
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
    await get('edit_shop_order').handler({ choose: [{ item: 'jamón', option: 'serrano' }], shop: 'la plaza', delivery: 'domicilio', address: 'C/ Mayor 1, 2.º B' }, ctx(api))
    expect(writes(calls)).toEqual([
      { method: 'PATCH', path: '/shop-orders/oc', body: { lines: [{ key: 'l1', choice: 'serrano' }], fulfilment: 'domicilio', address: 'C/ Mayor 1, 2.º B' } },
    ])
  })

  it('does nothing without a prepared order', async () => {
    const { api, calls } = fakeApi({ 'GET /shop-orders': [order({ status: 'sent' })] })
    const r = await get('edit_shop_order').handler({ add: [{ name: 'manzanas' }] }, ctx(api))
    expect(writes(calls)).toEqual([])
    expect(r.summary).toMatch(/No hay pedidos preparados/)
  })
})

describe('get_shop_orders', () => {
  it('says the Red states in words and gives a Red draft its /c/ link', async () => {
    const { api } = fakeApi({
      'GET /shop-orders': [
        order({ id: 'o9', status: 'draft', shop: { ...order().shop, name: 'Frutería de prueba' }, links: RED_LINKS, red: RED_VIEW }),
        order({ id: 'o8', status: 'ordered', shop: { ...order().shop, name: 'Carnicería de prueba' }, links: RED_LINKS, red: RED_VIEW }),
      ],
    })
    const r = await get('get_shop_orders').handler({}, ctx(api))
    expect(r.summary).toMatch(/Frutería de prueba: preparado, sin pedir → https:\/\/ona\.app\/c\/REDREDREDREDRED1/)
    expect(r.summary).toMatch(/Carnicería de prueba: pedido a la tienda de la Red, esperando que lo acepte/)
  })
})
