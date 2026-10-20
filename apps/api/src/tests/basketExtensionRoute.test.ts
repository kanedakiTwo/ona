/**
 * Rutas de «enviar la cesta a la extensión del navegador» (specs/shop-orders.md),
 * con los routers reales en un puerto efímero. La sesión, el store, la lista de
 * emails y `trackEvent` son falsos; el esquema, `basketSentProps`, `metricsAuth`
 * e `intParam` son los de verdad.
 *
 *   GET  /shop-extension/status             sesión; { enabled }
 *   POST /shop-orders/:id/extension-result  sesión + lista de emails (403 antes de validar);
 *                                           400 si el esquema no cumple; cuenta solo si se guardó
 *   POST /shop-orders/:id/extension-undo    sesión, sin mirar la lista; cuenta solo si se deshizo
 *   GET  /admin/extension-gaps              admin o `x-metrics-token`; `days` entero entre 1 y 90
 *
 * Run: pnpm --filter @ona/api test src/tests/basketExtensionRoute.test.ts
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {} }))
// Sesión falsa: `x-test-user` es el usuario y `x-test-role` su rol; sin cabecera, 401 como la de verdad.
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    const userId = req.get('x-test-user')
    if (!userId) return void res.status(401).json({ error: 'No token provided' })
    req.userId = userId
    req.user = { id: userId, role: req.get('x-test-role') ?? 'user', suspendedAt: null }
    next()
  },
  requireAdmin: (req: any, res: any, next: any) => (req.user?.role === 'admin' ? next() : res.status(403).json({ code: 'NOT_ADMIN' })),
}))
const h = vi.hoisted(() => ({
  enabled: vi.fn(async (_userId: string) => true),
  gaps: vi.fn(async (days: number) => [{ days }]),
  save: vi.fn(),
  undo: vi.fn(),
  track: vi.fn(),
}))
vi.mock('../services/basketExtension.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/basketExtension.js')>()),
  basketExtensionEnabledFor: h.enabled,
  loadBasketGaps: h.gaps,
}))
vi.mock('../services/shopOrders/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/shopOrders/store.js')>()),
  saveBasketResult: h.save,
  undoBasketSend: h.undo,
}))
vi.mock('../services/usageEvents.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/usageEvents.js')>()),
  trackEvent: h.track,
}))
vi.mock('../services/assistant/appApi.js', () => ({ appApiFor: vi.fn() }))
vi.mock('../middleware/spendCap.js', () => ({ requireSpendCapacity: () => (_req: any, _res: any, next: any) => next() }))

const { env } = await import('../config/env.js')
const { default: shopOrdersRouter } = await import('../routes/shopOrders.js')
const { default: metricsRouter } = await import('../routes/metrics.js')
const { ShopOrderError } = await import('../services/shopOrders/store.js')
const { errorHandler } = await import('../middleware/errorHandler.js')

let server: Server
let base = ''
const previousToken = env.METRICS_READ_TOKEN

beforeAll(async () => {
  env.METRICS_READ_TOKEN = 'gaps-test-token'
  const app = express()
  app.use(express.json())
  // Como en index.ts: el router de métricas antes que los que piden sesión.
  app.use(metricsRouter)
  app.use(shopOrdersRouter)
  app.use(errorHandler)
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  env.METRICS_READ_TOKEN = previousToken
  server?.closeAllConnections()
  server?.close()
})

beforeEach(() => {
  h.enabled.mockReset().mockResolvedValue(true)
  h.save.mockReset()
  h.undo.mockReset()
  h.track.mockReset()
  h.gaps.mockClear()
})

const ID = '11111111-2222-4333-8444-555555555555'
const USER = { 'x-test-user': 'u1' }
const TOKEN = { 'x-metrics-token': 'gaps-test-token' }
const good = {
  envioId: 'e1',
  ok: true,
  anadidas: 1,
  totalEur: 9.5,
  bajoMinimo: true,
  version: 'v',
  contrato: 'c',
  lineas: [{ key: 'l1', estado: 'tabla', producto: 'Arroz' }],
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = USER) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

describe('GET /shop-extension/status', () => {
  it('sin sesión 401; con sesión dice si este usuario ve el botón', async () => {
    expect((await call('GET', '/shop-extension/status', undefined, {})).status).toBe(401)
    expect(h.enabled).not.toHaveBeenCalled()
    h.enabled.mockResolvedValue(false)
    expect(await call('GET', '/shop-extension/status')).toEqual({ status: 200, body: { enabled: false } })
    expect(h.enabled).toHaveBeenCalledWith('u1')
  })
})

describe('POST /shop-orders/:id/extension-result', () => {
  const path = `/shop-orders/${ID}/extension-result`

  it('fuera de la lista: 403 antes de validar el cuerpo, sin guardar ni contar', async () => {
    h.enabled.mockResolvedValue(false)
    const r = await call('POST', path, { basura: 1 })
    expect(r.status).toBe(403)
    expect(h.save).not.toHaveBeenCalled()
    expect(h.track).not.toHaveBeenCalled()
  })
  it('cuerpo que no cumple el esquema 400; un id que no es uuid 404; sin guardar', async () => {
    expect((await call('POST', path, { ...good, ok: 'si' })).status).toBe(400)
    expect((await call('POST', path, { ...good, envioId: '' })).status).toBe(400)
    expect((await call('POST', '/shop-orders/no-uuid/extension-result', good)).status).toBe(404)
    expect(h.save).not.toHaveBeenCalled()
  })
  it('guardado: guarda lo validado (sin campos de más), responde { order, deshecho } y cuenta una vez con recuentos', async () => {
    h.save.mockResolvedValue({ order: { id: ID, status: 'sent' }, deshecho: false, guardado: true })
    const r = await call('POST', path, { ...good, deshechos: ['x'], hack: 1 })
    expect(r).toEqual({ status: 200, body: { order: { id: ID, status: 'sent' }, deshecho: false } })
    expect(h.save).toHaveBeenCalledWith('u1', ID, expect.anything())
    expect(h.save.mock.calls[0][2]).not.toHaveProperty('deshechos')
    expect(h.save.mock.calls[0][2]).not.toHaveProperty('hack')
    expect(h.track.mock.calls).toEqual([
      [
        'basket_extension_sent',
        { userId: 'u1', channel: 'web', props: { lineas: 1, tabla: 1, busqueda: 0, fallidas: 0, ok: true, error: 'ninguno', bajoMinimo: true } },
      ],
    ])
  })
  it('duracionMs llega al store con el resultado', async () => {
    h.save.mockResolvedValue({ order: { id: ID }, deshecho: false, guardado: true })
    expect((await call('POST', path, { ...good, duracionMs: 31_000 })).status).toBe(200)
    expect(h.save.mock.calls[0][2]).toMatchObject({ duracionMs: 31_000 })
    expect((await call('POST', path, { ...good, duracionMs: -1 })).status).toBe(400)
  })
  it('no guardado (el mismo envío otra vez, o uno deshecho): responde igual y no cuenta', async () => {
    h.save.mockResolvedValue({ order: { id: ID }, deshecho: true, guardado: false })
    expect(await call('POST', path, good)).toEqual({ status: 200, body: { order: { id: ID }, deshecho: true } })
    expect(h.track).not.toHaveBeenCalled()
  })
  it('errores del store: 404 y 409 con su código, sin contar', async () => {
    h.save.mockRejectedValueOnce(new ShopOrderError(404, 'NOT_FOUND', 'Pedido no encontrado.'))
    expect(await call('POST', path, good)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    h.save.mockRejectedValueOnce(new ShopOrderError(409, 'BAD_STATUS', 'No se puede guardar el envío.'))
    expect(await call('POST', path, good)).toMatchObject({ status: 409, body: { code: 'BAD_STATUS' } })
    expect(h.track).not.toHaveBeenCalled()
  })
})

describe('POST /shop-orders/:id/extension-undo', () => {
  const path = `/shop-orders/${ID}/extension-undo`

  it('no mira la lista de emails: fuera de ella también se deshace, y cuenta `manual` solo si es true', async () => {
    h.enabled.mockResolvedValue(false)
    h.undo.mockResolvedValue({ id: ID, status: 'draft' })
    expect(await call('POST', path, { manual: true })).toEqual({ status: 200, body: { id: ID, status: 'draft' } })
    expect(h.enabled).not.toHaveBeenCalled()
    expect(h.undo).toHaveBeenCalledWith('u1', ID)
    expect(h.track.mock.calls[0]).toEqual(['basket_extension_undo', { userId: 'u1', channel: 'web', props: { manual: true } }])
    await call('POST', path, { manual: 'true' })
    await call('POST', path)
    expect(h.track.mock.calls.slice(1).map((c) => c[1].props)).toEqual([{ manual: false }, { manual: false }])
  })
  it('si no se puede deshacer (409), no cuenta', async () => {
    h.undo.mockRejectedValueOnce(new ShopOrderError(409, 'NO_EXTENSION_SEND', 'Este pedido no se envió con la extensión.'))
    expect(await call('POST', path, { manual: true })).toMatchObject({ status: 409, body: { code: 'NO_EXTENSION_SEND' } })
    expect(h.track).not.toHaveBeenCalled()
  })
  it('sin sesión 401, sin deshacer', async () => {
    expect((await call('POST', path, {}, {})).status).toBe(401)
    expect(h.undo).not.toHaveBeenCalled()
  })
})

describe('GET /admin/extension-gaps', () => {
  it('sin token ni sesión 401; sesión normal 403; admin 200; token malo 401; token bueno 200', async () => {
    expect((await call('GET', '/admin/extension-gaps', undefined, {})).status).toBe(401)
    expect((await call('GET', '/admin/extension-gaps')).status).toBe(403)
    expect((await call('GET', '/admin/extension-gaps', undefined, { 'x-test-user': 'a', 'x-test-role': 'admin' })).status).toBe(200)
    expect((await call('GET', '/admin/extension-gaps', undefined, { 'x-metrics-token': 'malo' })).status).toBe(401)
    expect(await call('GET', '/admin/extension-gaps', undefined, TOKEN)).toEqual({ status: 200, body: { days: 7, gaps: [{ days: 7 }] } })
  })
  it('`days` llega a la consulta entero y entre 1 y 90 (make_interval solo acepta enteros)', async () => {
    const days = async (q: string) => (await call('GET', `/admin/extension-gaps?days=${q}`, undefined, TOKEN)).body.days
    const got = []
    for (const q of ['abc', '0', '-3', '1000', '3.9', '1e9', '30']) got.push(await days(q))
    expect(got).toEqual([7, 1, 1, 90, 3, 1, 30])
    expect(h.gaps.mock.calls.map(([n]) => n)).toEqual(got)
  })
})
