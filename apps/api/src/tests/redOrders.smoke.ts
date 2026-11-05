/**
 * Red de tiendas v2 (specs/shop-orders.md → «Red de tiendas») against a
 * running API and its database: the switch, the postal code, a Red frutería
 * assigned on its own, the card (−5 %, estimate, max), raising the max,
 * «Pedir», «ya está en un pedido abierto», cancelling, and a household outside
 * the switch that sees none of it. Registers its own @red.test.local users.
 *
 *   API_URL=http://localhost:8790 RED_TIENDAS_EMAILS=@red.test.local (on the API) DATABASE_URL=… \
 *     pnpm --filter @ona/api exec vitest run src/tests/redOrders.smoke.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DEFAULT_RED_SETTINGS } from '@ona/shared'
import { API_URL, reachable } from './smokeEnv.js'
import { pool } from '../db/connection.js'
import { householdAmount } from '../services/red/money.js'
import { RED_TEST_SHOPS, seedRedTestShops } from '../services/red/testShops.js'

const FRUTERIA = RED_TEST_SHOPS.find((s) => s.kind === 'fruteria')!

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

describe.skipIf(!reachable)('Red de tiendas · tramo 1a', () => {
  beforeAll(async () => {
    await seedRedTestShops({ postalCode: '28001' })
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

  it('the household’s own shop with a Red shop’s WhatsApp joins the Red', async () => {
    const api = call(await register('red.test.local'))
    await api('POST', '/shops', { name: 'Mi frutería', kind: 'fruteria', channel: 'whatsapp', whatsapp: FRUTERIA.whatsapp, fulfilment: 'recoger' })
    await addToList(api, [{ name: 'manzanas', quantity: 1000, unit: 'g', aisle: 'produce' }])
    const prep = (await api('POST', '/shop-orders/prepare', {})).body
    const order = prep.orders.find((o: any) => o.shop.kind === 'fruteria')
    expect(order.shop.name).toBe('Mi frutería')
    expect(order.red.ownShopJoined).toBe(true)
  })
})
