/**
 * Smoke test for "Compra en mis tiendas" (specs/shop-orders.md) against a
 * running API: shops CRUD, preparing per-shop orders from the real shopping
 * list, the wa.me links, the public short link, the draft → sent →
 * (quote → approve, with SMOKE_LLM=1) → close lifecycle and household
 * isolation. Registers its own throwaway users, so it runs standalone:
 *
 *   API_URL=http://localhost:8790 pnpm --filter @ona/api exec vitest run src/tests/shopOrdersRoute.smoke.ts
 *
 * Skips when the API isn't reachable.
 */

import { describe, it, expect, beforeAll } from 'vitest'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'
const WITH_LLM = process.env.SMOKE_LLM === '1'

async function isApiReachable(): Promise<boolean> {
  const r = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null)
  return r != null && r.ok
}

interface Session { token: string; userId: string }

async function register(): Promise<Session> {
  const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `shop_${id}`, email: `shop_${id}@test.local`, password: 'smokepass123', ageConfirmed: true }),
  })
  const body = await r.json()
  return { token: body.token, userId: body.user.id }
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

function mondayIso(): string {
  const d = new Date()
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

describe('shop orders route smoke', () => {
  let reachable = false
  let me: Session
  let api: ReturnType<typeof call>

  beforeAll(async () => {
    reachable = await isApiReachable()
    if (!reachable) return
    me = await register()
    api = call(me)
    await api('POST', `/user/${me.userId}/onboarding`, { householdSize: 'couple', cookingFreq: 'daily', restrictions: [], favoriteDishes: ['merluza', 'pollo', 'ensalada'], priority: 'healthy' })
    await api('POST', '/menu/generate', { userId: me.userId, weekStart: mondayIso() })
  }, 60_000)

  it('validates shops: WhatsApp channel needs a number; Spanish numbers get +34', async () => {
    if (!reachable) return
    const bad = await api('POST', '/shops', { name: 'Frutería', kind: 'fruteria', channel: 'whatsapp', fulfilment: 'recoger' })
    expect(bad.status).toBe(400)
    const ok = await api('POST', '/shops', { name: 'The Fruits of the World', kind: 'fruteria', channel: 'whatsapp', whatsapp: '34913525111', customerName: 'Miguel', fulfilment: 'recoger' })
    expect(ok.status).toBe(201)
    expect(ok.body.whatsapp).toBe('34913525111')
  })

  it('prepares one order per shop from the list, with ready-to-send links', async () => {
    if (!reachable) return
    await api('POST', '/shops', { name: 'Pescados Aparicio', kind: 'pescaderia', channel: 'whatsapp', whatsapp: '34600000000', fulfilment: 'recoger' })
    await api('POST', '/shops', { name: 'El Corte Inglés', kind: 'supermercado', channel: 'web', webUrl: 'https://www.elcorteingles.es/supermercado/', fulfilment: 'domicilio', address: 'C/ Real 1, Boadilla' })

    const r = await api('POST', '/shop-orders/prepare', {})
    expect(r.status).toBe(200)
    expect(r.body.hasShops).toBe(true)
    const orders = r.body.orders as any[]
    if (orders.length === 0) return // empty menu in this DB — nothing to route
    for (const o of orders) {
      expect(o.status).toBe('draft')
      expect(o.lines.length).toBeGreaterThan(0)
      if (o.shop.channel === 'whatsapp') {
        expect(o.links.order).toMatch(/^https:\/\/wa\.me\/34\d+/)
        expect(o.links.shortOrder).toMatch(/\/c\/[A-Za-z0-9_-]{16}$/)
        expect(o.messageText).toContain('- ')
      }
      if (o.shop.channel === 'web') {
        expect(Object.values(o.searchLinks)[0]).toMatch(/elcorteingles\.es\/supermercado\/buscar\?question=/)
      }
    }
    // Re-preparing replaces the drafts instead of piling them up.
    const again = await api('POST', '/shop-orders/prepare', {})
    const list = await api('GET', '/shop-orders')
    expect(list.body.length).toBe(again.body.orders.length)
  }, 60_000)

  it('short link resolves publicly without changing the order', async () => {
    if (!reachable) return
    const [o] = (await api('GET', '/shop-orders')).body
    if (!o?.links.shortOrder) return
    const token = o.links.shortOrder.split('/c/')[1]
    const r = await fetch(`${API_URL}/shop-orders/link/${token}`)
    expect(r.status).toBe(200)
    expect((await r.json()).url).toBe(o.links.order)
    expect((await api('GET', `/shop-orders/${o.id}`)).body.status).toBe('draft')
    expect((await fetch(`${API_URL}/shop-orders/link/not-a-real-token-xx`)).status).toBe(404)
  })

  it('edits a draft, then sent → (quote → approve) → close', async () => {
    if (!reachable) return
    const orders = (await api('GET', '/shop-orders')).body as any[]
    const o = orders.find((x) => x.shop.channel === 'whatsapp')
    if (!o) return
    const first = o.lines[0]
    const edited = await api('PATCH', `/shop-orders/${o.id}`, { lines: [{ key: first.key, note: 'en filetes' }] })
    expect(edited.body.messageText).toContain('en filetes')

    expect((await api('POST', `/shop-orders/${o.id}/approve`, {})).status).toBe(409) // nothing quoted yet
    expect((await api('POST', `/shop-orders/${o.id}/sent`)).body.status).toBe('sent')
    expect((await api('PATCH', `/shop-orders/${o.id}`, { capEur: 50 })).status).toBe(409) // no edits once sent
    expect((await api('POST', `/shop-orders/${o.id}/quote`, { text: '' })).status).toBe(400)

    if (WITH_LLM) {
      const reply = `Hola! Te lo preparo todo. ${first.name} ok a 3,20 el kilo. Total unos 25 euros, lo recoges mañana a partir de las 11.`
      const quoted = await api('POST', `/shop-orders/${o.id}/quote`, { text: reply })
      expect(quoted.status).toBe(200)
      expect(quoted.body.status).toBe('quoted')
      expect(quoted.body.lines.find((l: any) => l.key === first.key).quote?.status).toBe('ok')
      const approved = await api('POST', `/shop-orders/${o.id}/approve`, { decisions: {} })
      expect(approved.body.status).toBe('approved')
      expect(approved.body.links.confirmation).toMatch(/^https:\/\/wa\.me\/.*adelante/)
    }

    const closed = await api('POST', `/shop-orders/${o.id}/close`, { finalTotalEur: 24.5 })
    expect(closed.body.status).toBe('closed')
    expect(closed.body.finalTotalEur).toBe(24.5)
    const list = await api('GET', '/shopping-list')
    const bought = new Set(o.lines.map((l: any) => l.sourceItemId))
    const ticked = (list.body.items as any[]).filter((i) => bought.has(i.id))
    expect(ticked.every((i) => i.checked)).toBe(true)
  }, 90_000)

  it("another household can't see or touch my shops and orders", async () => {
    if (!reachable) return
    const other = call(await register())
    expect((await other('GET', '/shops')).body).toEqual([])
    expect((await other('GET', '/shop-orders')).body).toEqual([])
    const mine = (await api('GET', '/shops')).body as any[]
    expect((await other('DELETE', `/shops/${mine[0].id}`)).status).toBe(404)
    const orders = (await api('GET', '/shop-orders')).body as any[]
    if (orders[0]) expect((await other('POST', `/shop-orders/${orders[0].id}/cancel`)).status).toBe(404)
  }, 30_000)
})
