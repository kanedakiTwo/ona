/**
 * Red de tiendas v2 (specs/red-tiendas.md) against a
 * running API and its database: the switch, the postal code, a Red frutería
 * assigned on its own, the card (−5 %, estimate, max), raising the max,
 * «Pedir», «ya está en un pedido abierto», cancelling, and a household outside
 * the switch that sees none of it; «Pedir» refused when the terms changed or
 * the shop is paused, no cancel once the shop is preparing it, no delivery from
 * a shop that doesn't deliver, the Red question and the postal code against
 * the shops' area, and an own shop that stops matching a Red one.
 * Registers its own @red.test.local users. The tests that change the shared
 * red_settings row or a test shop put it back in `finally`.
 *
 *   API_URL=http://localhost:8790 RED_TIENDAS_EMAILS=@red.test.local (on the API) DATABASE_URL=… \
 *     pnpm --filter @ona/api exec vitest run src/tests/redOrders.smoke.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { DEFAULT_RED_SETTINGS } from '@ona/shared'
import { API_URL, reachable } from './smokeEnv.js'
import { db, pool } from '../db/connection.js'
import { redSettings, redShops, shopOrders } from '../db/schema.js'
import { householdAmount } from '../services/red/money.js'
import { RED_TEST_SHOPS, seedRedTestShops } from '../services/red/testShops.js'

const FRUTERIA = RED_TEST_SHOPS.find((s) => s.kind === 'fruteria')!
/** A postal code no test shop is in or delivers to (they're seeded in 28001). */
const UNCOVERED_CP = '08001'
const APPLES = { name: 'manzanas', quantity: 1000, unit: 'g', aisle: 'produce' }

interface Session { token: string }

async function register(domain: string): Promise<Session> {
  const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `red_${id}`, email: `red_${id}@${domain}`, password: 'smokepass123', ageConfirmed: true }),
  })
  const body = await r.json().catch(() => null)
  if (!r.ok || typeof body?.token !== 'string') throw new Error(`register failed: ${r.status} ${JSON.stringify(body)}`)
  return { token: body.token }
}

function call(s: Session) {
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    return { status: r.status, body: text ? JSON.parse(text) : null }
  }
}

async function addToList(api: ReturnType<typeof call>, items: Array<Record<string, unknown>>) {
  const list = (await api('GET', '/shopping-list')).body
  for (const item of items) expect((await api('POST', `/shopping-list/${list.id}/items`, item)).status).toBeLessThan(300)
}

/** A Red household in 28001 with these items on its list, and its first «Preparar». */
async function redHousehold(items: Array<Record<string, unknown>> = [APPLES]) {
  const api = call(await register('red.test.local'))
  expect((await api('PUT', '/red/postal-code', { postalCode: '28001' })).status).toBe(200)
  await addToList(api, items)
  const prep = (await api('POST', '/shop-orders/prepare', {})).body
  return { api, prep }
}

describe.skipIf(!reachable)('Red de tiendas · tramo 1a', () => {
  let seeded: Array<{ id: string; kind: string; name: string }> = []
  beforeAll(async () => {
    seeded = await seedRedTestShops({ postalCode: '28001' })
  })
  // This file opens the database itself (to seed the test shops): close it so vitest can exit.
  afterAll(async () => {
    await pool.end()
  })

  it('outside the switch: nothing changes', async () => {
    const api = call(await register('test.local'))
    expect((await api('GET', '/red/status')).body).toEqual({ enabled: false, postalCode: null })
    expect((await api('PUT', '/red/postal-code', { postalCode: '28001' })).status).toBe(403)
    const prep = (await api('POST', '/shop-orders/prepare', {})).body
    expect(prep.red.enabled).toBe(false)
  })

  it('postal code → a Red frutería on its own → card with −5 % and max → «Pedir» → cancel', async () => {
    const api = call(await register('red.test.local'))
    await addToList(api, [{ name: 'manzanas', quantity: 1000, unit: 'g', aisle: 'produce' }])

    // No postal code yet: asked, nothing assigned.
    let prep = (await api('POST', '/shop-orders/prepare', {})).body
    expect(prep.red).toMatchObject({ enabled: true, needsPostalCode: true })
    expect(prep.orders).toEqual([])

    expect((await api('PUT', '/red/postal-code', { postalCode: '99999' })).status).toBe(400)
    expect((await api('PUT', '/red/postal-code', { postalCode: '28001' })).body).toEqual({ postalCode: '28001' })

    prep = (await api('POST', '/shop-orders/prepare', {})).body
    expect(prep.red.assigned.map((a: any) => [a.kind, a.name])).toEqual([['fruteria', FRUTERIA.name]])
    const order = prep.orders.find((o: any) => o.shop.kind === 'fruteria')
    expect(order.red).toMatchObject({ terms: { discountPct: 5, commissionPct: 5 }, delivers: true })
    expect(order.links.order).toBeNull()
    expect(order.links.shortOrder).toMatch(/\/c\//)
    expect(order.red.estimateShopEur).not.toBeNull()
    expect(order.red.estimateEur).toBe(householdAmount(order.red.estimateShopEur, DEFAULT_RED_SETTINGS))

    // The short link opens the card on /compra, never wa.me.
    const token = order.links.shortOrder.split('/c/')[1]
    expect((await api('GET', `/shop-orders/link/${token}`)).body).toEqual({ url: `/compra?pedido=${order.id}` })

    // The shop shows in «Tus tiendas» as a Red one, and can't be edited.
    const shops = (await api('GET', '/shops')).body
    const copy = shops.find((s: any) => s.origin === 'red')
    expect(copy).toMatchObject({ kind: 'fruteria', name: FRUTERIA.name })
    expect((await api('PATCH', `/shops/${copy.id}`, { name: 'Otra', kind: 'fruteria', channel: 'whatsapp', whatsapp: FRUTERIA.whatsapp, fulfilment: 'recoger' })).status).toBe(409)

    // Raise the max; it can't go under what's expected.
    expect((await api('PATCH', `/shop-orders/${order.id}`, { maxEur: 1 })).status).toBe(400)
    const raised = (await api('PATCH', `/shop-orders/${order.id}`, { maxEur: order.red.maxEur + 5 })).body
    expect(raised.red).toMatchObject({ maxEur: order.red.maxEur + 5, maxRaised: true })

    // «Pedir» with a stale max is refused; with the one shown, ordered.
    expect((await api('POST', `/shop-orders/${order.id}/order`, { maxEur: order.red.maxEur })).status).toBe(409)
    const ordered = (await api('POST', `/shop-orders/${order.id}/order`, { maxEur: raised.red.maxEur })).body
    expect(ordered.status).toBe('ordered')

    // Its lines are «ya está en un pedido abierto»; the household can't close it by hand.
    prep = (await api('POST', '/shop-orders/prepare', {})).body
    expect(prep.skipped.map((s: any) => s.reason)).toContain('ya está en un pedido abierto')
    expect((await api('POST', `/shop-orders/${order.id}/close`, {})).status).toBe(409)

    // Cancel → the apples are pending again.
    expect((await api('POST', `/shop-orders/${order.id}/cancel`)).body.status).toBe('cancelled')
    prep = (await api('POST', '/shop-orders/prepare', {})).body
    expect(prep.orders.some((o: any) => o.red && o.lines.some((l: any) => /manzana/.test(l.name)))).toBe(true)
  })

  it('a household with a súper is asked once; «al súper» is remembered', async () => {
    const api = call(await register('red.test.local'))
    await api('POST', '/shops', { name: 'Súper del barrio', kind: 'supermercado', channel: 'whatsapp', whatsapp: '34600000099', fulfilment: 'recoger' })
    await api('PUT', '/red/postal-code', { postalCode: '28001' })
    await addToList(api, [{ name: 'manzanas', quantity: 1000, unit: 'g', aisle: 'produce' }])

    let prep = (await api('POST', '/shop-orders/prepare', {})).body
    expect(prep.red.questions.map((q: any) => [q.kind, q.superName])).toEqual([['fruteria', 'Súper del barrio']])
    expect(prep.orders.every((o: any) => !o.red)).toBe(true)

    expect((await api('POST', '/red/choice', { kind: 'fruteria', choice: 'super' })).status).toBe(200)
    prep = (await api('POST', '/shop-orders/prepare', {})).body
    expect(prep.red.questions).toEqual([])
  })

  it('a Red draft never goes the WhatsApp way, and a removed Red shop is not assigned again', async () => {
    const api = call(await register('red.test.local'))
    await api('PUT', '/red/postal-code', { postalCode: '28001' })
    await addToList(api, [{ name: 'manzanas', quantity: 1000, unit: 'g', aisle: 'produce' }])
    let prep = (await api('POST', '/shop-orders/prepare', {})).body
    const order = prep.orders.find((o: any) => o.red)
    expect((await api('POST', `/shop-orders/${order.id}/sent`)).status).toBe(409)
    expect((await api('POST', `/shop-orders/${order.id}/quote`, { text: 'Todo ok, 3 €' })).status).toBe(409)
    expect((await api('POST', `/shop-orders/${order.id}/approve`, {})).status).toBe(409)

    // «No la quiero»: removing the Red copy is remembered (the next «Preparar» doesn't bring it back).
    const copy = (await api('GET', '/shops')).body.find((s: any) => s.origin === 'red')
    expect((await api('DELETE', `/shops/${copy.id}`)).status).toBe(204)
    prep = (await api('POST', '/shop-orders/prepare', {})).body
    expect(prep.red.assigned).toEqual([])
    expect((await api('GET', '/shops')).body.some((s: any) => s.origin === 'red')).toBe(false)
  })

  it('the household’s own shop with a Red shop’s WhatsApp joins the Red; another WhatsApp unlinks it', async () => {
    const api = call(await register('red.test.local'))
    const mine = { name: 'Mi frutería', kind: 'fruteria', channel: 'whatsapp', whatsapp: FRUTERIA.whatsapp, fulfilment: 'recoger' }
    const own = (await api('POST', '/shops', mine)).body
    await addToList(api, [APPLES])
    let prep = (await api('POST', '/shop-orders/prepare', {})).body
    let order = prep.orders.find((o: any) => o.shop.kind === 'fruteria')
    expect(order.shop.name).toBe('Mi frutería')
    expect(order.red.ownShopJoined).toBe(true)

    // Another WhatsApp: no longer the Red shop, so no longer linked (and «Preparar» doesn't link it back).
    expect((await api('PATCH', `/shops/${own.id}`, { ...mine, whatsapp: '34600000098' })).body.redShopId).toBeNull()
    prep = (await api('POST', '/shop-orders/prepare', {})).body
    order = prep.orders.find((o: any) => o.shop.kind === 'fruteria')
    expect(order.shop.name).toBe('Mi frutería')
    expect(order.red).toBeNull()
    expect(order.links.order).toMatch(/^https:\/\/wa\.me\/34600000098/)
  })

  it('TERMS_CHANGED: «Pedir» is refused, the draft gets the new terms and its max back to the computed one, and the next «Pedir» goes', async () => {
    const { api, prep } = await redHousehold()
    const order = prep.orders.find((o: any) => o.red)
    const raised = (await api('PATCH', `/shop-orders/${order.id}`, { maxEur: order.red.maxEur + 5 })).body
    expect(raised.red.maxRaised).toBe(true)

    const [before] = await db.select({ termsVersion: redSettings.termsVersion }).from(redSettings).where(eq(redSettings.id, 1)).limit(1)
    expect(before).toBeTruthy()
    const changed = `${before.termsVersion}-smoke`
    try {
      await db.update(redSettings).set({ termsVersion: changed }).where(eq(redSettings.id, 1))
      const refused = await api('POST', `/shop-orders/${order.id}/order`, { maxEur: raised.red.maxEur })
      expect(refused.status).toBe(409)
      expect(refused.body.code).toBe('TERMS_CHANGED')

      const fresh = (await api('GET', `/shop-orders/${order.id}`)).body
      expect(fresh.status).toBe('draft')
      expect(fresh.red.terms.termsVersion).toBe(changed)
      expect(fresh.red).toMatchObject({ maxEur: order.red.maxEur, maxRaised: false })

      const ordered = await api('POST', `/shop-orders/${order.id}/order`, { maxEur: fresh.red.maxEur })
      expect(ordered.status).toBe(200)
      expect(ordered.body.status).toBe('ordered')
      expect(ordered.body.red.terms.termsVersion).toBe(changed)
    } finally {
      await db.update(redSettings).set({ termsVersion: before.termsVersion }).where(eq(redSettings.id, 1))
    }
  })

  it('RED_SHOP_UNAVAILABLE: a paused Red shop takes no «Pedir»', async () => {
    const { api, prep } = await redHousehold()
    const order = prep.orders.find((o: any) => o.red)
    const [shop] = await db.select({ status: redShops.status }).from(redShops).where(eq(redShops.whatsapp, FRUTERIA.whatsapp)).limit(1)
    try {
      await db.update(redShops).set({ status: 'pausada' }).where(eq(redShops.whatsapp, FRUTERIA.whatsapp))
      const r = await api('POST', `/shop-orders/${order.id}/order`, { maxEur: order.red.maxEur })
      expect(r.status).toBe(409)
      expect(r.body.code).toBe('RED_SHOP_UNAVAILABLE')
      expect((await api('GET', `/shop-orders/${order.id}`)).body.status).toBe('draft')
    } finally {
      await db.update(redShops).set({ status: shop.status }).where(eq(redShops.whatsapp, FRUTERIA.whatsapp))
    }
  })

  it('once the shop is preparing it, the household can no longer cancel it (409)', async () => {
    const { api, prep } = await redHousehold()
    const order = prep.orders.find((o: any) => o.red)
    expect((await api('POST', `/shop-orders/${order.id}/order`, { maxEur: order.red.maxEur })).body.status).toBe('ordered')
    // Tramo 1a has no shop side yet: the shop starting it is written straight to the order.
    await db.update(shopOrders).set({ status: 'preparing' }).where(eq(shopOrders.id, order.id))
    const r = await api('POST', `/shop-orders/${order.id}/cancel`)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('BAD_STATUS')
    expect((await api('GET', `/shop-orders/${order.id}`)).body.status).toBe('preparing')
  })

  it('NO_DELIVERY: a Red carnicería that doesn’t deliver can’t be switched to home delivery', async () => {
    const { api, prep } = await redHousehold([{ name: 'filetes de ternera', quantity: 500, unit: 'g', aisle: 'proteinas' }])
    const order = prep.orders.find((o: any) => o.red && o.shop.kind === 'carniceria')
    expect(order).toBeTruthy()
    expect(order.red.delivers).toBe(false)
    const r = await api('PATCH', `/shop-orders/${order.id}`, { fulfilment: 'domicilio', address: 'Calle de prueba 1' })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('NO_DELIVERY')
    expect((await api('GET', `/shop-orders/${order.id}`)).body.fulfilment).toBe('recoger')
  })

  it('choosing a Red shop that doesn’t reach the household’s postal code answers 404', async () => {
    const api = call(await register('red.test.local'))
    expect((await api('PUT', '/red/postal-code', { postalCode: UNCOVERED_CP })).status).toBe(200)
    const fruteria = seeded.find((s) => s.kind === 'fruteria')!
    const r = await api('POST', '/red/choice', { kind: 'fruteria', choice: 'red', redShopId: fruteria.id })
    expect(r.status).toBe(404)
    expect((await api('GET', '/shops')).body.some((s: any) => s.origin === 'red')).toBe(false)
  })

  it('a postal code no Red shop covers drops the household’s Red copies', async () => {
    const { api } = await redHousehold()
    expect((await api('GET', '/shops')).body.some((s: any) => s.origin === 'red')).toBe(true)
    expect((await api('PUT', '/red/postal-code', { postalCode: UNCOVERED_CP })).status).toBe(200)
    expect((await api('GET', '/shops')).body.filter((s: any) => s.origin === 'red')).toEqual([])
  })
})
