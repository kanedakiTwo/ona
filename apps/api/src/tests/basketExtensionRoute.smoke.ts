/**
 * «Enviar la cesta a la extensión del navegador» contra una API en marcha
 * (specs/shop-orders.md). La API necesita BASKET_EXTENSION_EMAILS=@test.local
 * (y METRICS_READ_TOKEN para los huecos y los eventos). Usa smokeEnv: en CI
 * (SMOKE_REQUIRED=true) una API caída falla, no se salta en silencio.
 *
 *   pnpm --filter @ona/api smoke     # levanta Postgres + API y pasa todos los *.smoke.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { API_URL, reachable } from './smokeEnv.js'

const METRICS = process.env.METRICS_READ_TOKEN

async function session(prefix: string, domain = 'test.local') {
  const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `${prefix}_${id}`, email: `${prefix}_${id}@${domain}`, password: 'smokepass123', ageConfirmed: true }),
  })
  const { token } = (await r.json()) as { token: string }
  return async (method: string, path: string, data?: unknown) => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
}
type Api = Awaited<ReturnType<typeof session>>

async function superOrder(api: Api, items: Array<{ name: string; quantity: number; unit: string }>) {
  await api('POST', '/shops', { name: 'Súper de prueba', kind: 'supermercado', channel: 'web', webUrl: 'https://tienda.example/', customerName: 'Ana' })
  const list = await api('GET', '/shopping-list')
  for (const item of items) await api('POST', `/shopping-list/${list.body.id}/items`, { ...item, aisle: 'otros' })
  const prep = await api('POST', '/shop-orders/prepare', {})
  return prep.body.orders.find((o: { shop: { kind: string } }) => o.shop.kind === 'supermercado')
}

const result = (over: Record<string, unknown> = {}) => ({
  envioId: 'e1', ok: true, anadidas: 2, totalEur: 9.5, bajoMinimo: true, version: 'smoke', contrato: 'smoke',
  lineas: [
    { key: 'l1', estado: 'tabla', productoId: '1', producto: 'Uno', unidades: 1 },
    { key: 'l2', estado: 'busqueda', productoId: '2', producto: 'Dos', unidades: 1 },
  ],
  ...over,
})

/** Nombre de la línea del pedido que el resultado guardado marca con `estado`. */
function lineNameWith(order: any, estado: string): string {
  const key = order.extensionResult.lineas.find((l: { estado: string }) => l.estado === estado).key
  return order.lines.find((l: { key: string }) => l.key === key).name
}

/** Eventos de hoy en /admin/usage (con el token de métricas). */
async function usageCount(name: string): Promise<number> {
  const r = await fetch(`${API_URL}/admin/usage?days=1`, { headers: { 'x-metrics-token': METRICS! } })
  return Number((await r.json()).totals.events[name] ?? 0)
}

/**
 * `trackEvent` escribe sin esperar: se espera a que cambie el recuento y, después,
 * un poco más, para que un evento de más que aún esté en vuelo también se cuente.
 */
async function usageCountAfter(name: string, before: number): Promise<number> {
  let after = before
  for (let i = 0; i < 20 && after === before; i++) {
    await new Promise((r) => setTimeout(r, 250))
    after = await usageCount(name)
  }
  await new Promise((r) => setTimeout(r, 500))
  return usageCount(name)
}

describe.skipIf(!reachable)('extensión del navegador · rutas', () => {
  let api: Api
  let orderId = ''

  beforeAll(async () => {
    api = await session('ext')
    const order = await superOrder(api, [
      { name: 'arroz', quantity: 1000, unit: 'g' },
      { name: 'detergente', quantity: 1, unit: 'u' },
      { name: 'servilletas', quantity: 1, unit: 'u' },
    ])
    orderId = order.id
  }, 30_000)

  it('status: permitido por @test.local', async () => {
    expect((await api('GET', '/shop-extension/status')).body).toEqual({ enabled: true })
  })

  it('resultado bueno → sent; uno vacío no lo pisa; el mismo envioId otra vez no cambia nada; cuenta una vez', async () => {
    const before = METRICS ? await usageCount('basket_extension_sent') : 0
    const first = await api('POST', `/shop-orders/${orderId}/extension-result`, result())
    expect(first.status).toBe(200)
    expect(first.body.order.status).toBe('sent')
    expect(first.body.order.extensionResult.anadidas).toBe(2)
    const empty = await api('POST', `/shop-orders/${orderId}/extension-result`, result({ envioId: '', ok: false, error: 'red', lineas: [], anadidas: 0, totalEur: null }))
    expect(empty.body.order.extensionResult.anadidas).toBe(2)
    const again = await api('POST', `/shop-orders/${orderId}/extension-result`, result({ repetido: true }))
    expect(again.body).toMatchObject({ deshecho: false })
    // Primer envío + el mismo envioId otra vez + uno vacío = un solo basket_extension_sent.
    if (METRICS) expect((await usageCountAfter('basket_extension_sent', before)) - before).toBe(1)
  }, 30_000)

  it('deshacer → draft (una vez: el segundo, 409); un repetido del envío deshecho → deshecho; un envío nuevo vuelve a sent', async () => {
    const before = METRICS ? await usageCount('basket_extension_undo') : 0
    const undo = await api('POST', `/shop-orders/${orderId}/extension-undo`, { manual: true })
    expect(undo.body.status).toBe('draft')
    expect((await api('POST', `/shop-orders/${orderId}/extension-undo`, { manual: true })).status).toBe(409)
    // Un deshacer + un segundo deshacer rechazado = un solo basket_extension_undo.
    if (METRICS) expect((await usageCountAfter('basket_extension_undo', before)) - before).toBe(1)
    const stale = await api('POST', `/shop-orders/${orderId}/extension-result`, result({ repetido: true }))
    expect(stale.body.deshecho).toBe(true)
    const fresh = await api('POST', `/shop-orders/${orderId}/extension-result`, result({ envioId: 'e2', lineas: [
      { key: 'l1', estado: 'tabla', productoId: '1', unidades: 1 },
      { key: 'l2', estado: 'fallida', motivo: 'no_encontrado' },
    ], anadidas: 1 }))
    expect(fresh.body.order.status).toBe('sent')
  }, 30_000)

  it('cerrar solo tacha en la lista lo que entró en el carro', async () => {
    const order = (await api('GET', `/shop-orders/${orderId}`)).body
    const failedName = lineNameWith(order, 'fallida')
    const addedName = lineNameWith(order, 'tabla')
    expect((await api('POST', `/shop-orders/${orderId}/close`, {})).body.status).toBe('closed')
    const list = (await api('GET', '/shopping-list')).body
    const checked = (name: string) => list.items.find((i: { name: string }) => i.name === name).checked
    expect(checked(failedName)).toBe(false)
    expect(checked(addedName)).toBe(true)
  })

  it('una línea fusionada guarda sus productos, y los pierde si el usuario cambia la cantidad', async () => {
    const otro = await session('extm')
    const order = await superOrder(otro, [
      { name: 'alubias blancas', quantity: 400, unit: 'g' },
      { name: 'alubias rojas', quantity: 400, unit: 'g' },
    ])
    const linea = order.lines.find((l: { members?: unknown[] }) => l.members)
    expect(linea?.members).toHaveLength(2)
    const patched = await otro('PATCH', `/shop-orders/${order.id}`, { lines: [{ key: linea.key, quantity: 1000, unit: 'g' }] })
    expect(patched.status).toBe(200)
    expect(patched.body.lines.find((l: { key: string }) => l.key === linea.key).members ?? null).toBeNull()
  }, 30_000)

  it('huecos: sin credenciales 401; con una sesión normal (no admin) 403', async () => {
    expect((await fetch(`${API_URL}/admin/extension-gaps?days=1`)).status).toBe(401)
    expect((await api('GET', '/admin/extension-gaps?days=1')).status).toBe(403)
  })

  it.skipIf(!METRICS)('huecos con el token de métricas (sin sesión), con estado y motivo', async () => {
    const r = await fetch(`${API_URL}/admin/extension-gaps?days=1`, { headers: { 'x-metrics-token': METRICS! } })
    expect(r.status).toBe(200)
    const { gaps } = await r.json()
    expect(Array.isArray(gaps)).toBe(true)
    const name = lineNameWith((await api('GET', `/shop-orders/${orderId}`)).body, 'fallida')
    expect(gaps).toContainEqual(expect.objectContaining({ name, estado: 'fallida', motivo: 'no_encontrado' }))
  })

  it('sin permiso: status false y 403 al guardar un resultado', async () => {
    const fuera = await session('noext', 'otro.example')
    expect((await fuera('GET', '/shop-extension/status')).body).toEqual({ enabled: false })
    const order = await superOrder(fuera, [{ name: 'arroz', quantity: 1000, unit: 'g' }])
    expect((await fuera('POST', `/shop-orders/${order.id}/extension-result`, result())).status).toBe(403)
  }, 30_000)
})
