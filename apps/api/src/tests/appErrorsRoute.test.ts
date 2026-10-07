/**
 * Route tests for the in-house error tracker (specs/errors.md), on a real
 * Express app bound to an ephemeral port. DB-touching dependencies (record,
 * load, resolve) are injected fakes; auth and body parsing are the real thing.
 *
 *   POST /client-errors   public: 204 on valid, 400 malformed, 413 > 8 KB,
 *                         per-IP limit silently drops (still 204)
 *   GET  /admin/errors    401 without credentials, 200 with x-metrics-token
 *   POST /admin/errors/:id/resolve   admin JWT only (the read token can't mutate)
 */
import express from 'express'
import type { RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildClientErrorReport } from '@ona/shared'
import { env } from '../config/env.js'
import adminErrorsRouter, {
  createAdminErrorsRouter,
  createClientErrorsRouter,
  parseClientErrorBody,
} from '../routes/appErrors.js'

const servers: Server[] = []

async function serve(app: express.Express): Promise<string> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

const VALID = JSON.stringify({ kind: 'client', message: 'boom', path: '/menu', stack: 'Error: boom\n    at f (https://ona.app/a.js:1:2)' })

function post(base: string, body: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/client-errors`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8', ...headers },
    body,
  })
}

describe('POST /client-errors', () => {
  const record = vi.fn()
  let base: string

  beforeAll(async () => {
    const app = express()
    // Mounted like index.ts: before the global JSON parser.
    app.use(createClientErrorsRouter({ record, perIpMax: 1000, rateLimitDisabled: false }))
    app.use(express.json())
    base = await serve(app)
  })
  afterEach(() => record.mockClear())

  it('accepts a beacon-style text/plain report with 204 and records it as a client error', async () => {
    const res = await post(base, VALID, { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36' })
    expect(res.status).toBe(204)
    expect(record).toHaveBeenCalledOnce()
    expect(record.mock.calls[0][0]).toMatchObject({
      kind: 'client',
      message: 'boom',
      path: '/menu',
      userAgent: expect.stringContaining('Android'),
    })
    expect(record.mock.calls[0][0].userId).toBeUndefined()
  })

  it('accepts application/json too (fetch fallback)', async () => {
    const res = await post(base, VALID, { 'content-type': 'application/json' })
    expect(res.status).toBe(204)
    expect(record).toHaveBeenCalledOnce()
  })

  it('accepts exactly what the web reporter builds (contract)', async () => {
    const body = JSON.stringify(buildClientErrorReport({ message: 'x'.repeat(50_000), stack: 'y\n'.repeat(50_000), path: '/a?b=c' }))
    expect(parseClientErrorBody(body)).not.toBeNull()
    expect((await post(base, body)).status).toBe(204)
  })

  it('rejects malformed JSON, schema violations and empty bodies with 400, recording nothing', async () => {
    for (const body of ['{not json', JSON.stringify({ kind: 'server', message: 'x' }), JSON.stringify({ kind: 'client' }), '']) {
      const res = await post(base, body)
      expect(res.status).toBe(400)
    }
    expect(record).not.toHaveBeenCalled()
  })

  it('rejects bodies over 8 KB with 413, recording nothing', async () => {
    const big = JSON.stringify({ kind: 'client', message: 'm', stack: 's'.repeat(9 * 1024) })
    const res = await post(base, big)
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('ERROR_REPORT_TOO_LARGE')
    expect(record).not.toHaveBeenCalled()
  })

  it('an invalid Bearer token does not block the report: recorded anonymously', async () => {
    const res = await post(base, VALID, { authorization: 'Bearer not.a.jwt' })
    expect(res.status).toBe(204)
    expect(record.mock.calls[0][0].userId).toBeUndefined()
  })

  it('a failing session lookup still answers 204 and records anonymously', async () => {
    const failing: RequestHandler = () => Promise.reject(new Error('db down')) as unknown as void
    const app = express()
    const rec = vi.fn()
    app.use(createClientErrorsRouter({ record: rec, optionalAuth: failing, rateLimitDisabled: true }))
    const b = await serve(app)
    expect((await post(b, VALID, { authorization: 'Bearer x' })).status).toBe(204)
    expect(rec).toHaveBeenCalledOnce()
  })

  it('per-IP limit: over it the client still gets 204 but nothing is recorded', async () => {
    const app = express()
    app.set('trust proxy', 1)
    const rec = vi.fn()
    app.use(createClientErrorsRouter({ record: rec, perIpMax: 3, rateLimitDisabled: false }))
    const b = await serve(app)
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) statuses.push((await post(b, VALID, { 'x-forwarded-for': '203.0.113.9' })).status)
    expect(statuses).toEqual([204, 204, 204, 204, 204])
    expect(rec).toHaveBeenCalledTimes(3)
    // Another IP has its own budget.
    await post(b, VALID, { 'x-forwarded-for': '203.0.113.10' })
    expect(rec).toHaveBeenCalledTimes(4)
  })
})

describe('GET /admin/errors', () => {
  const previousToken = env.METRICS_READ_TOKEN
  const load = vi.fn(async (q: any) => ({ totals: { groups: 0 }, groups: [], query: q }))
  let base: string
  let defaultBase: string

  beforeAll(async () => {
    env.METRICS_READ_TOKEN = 'errors-test-token'
    const app = express()
    // Real metricsAuth (the default readAuth), fake loader.
    app.use(createAdminErrorsRouter({ load: load as any }))
    base = await serve(app)
    const defaultApp = express()
    defaultApp.use(adminErrorsRouter)
    defaultBase = await serve(defaultApp)
  })
  afterAll(() => {
    env.METRICS_READ_TOKEN = previousToken
  })
  afterEach(() => load.mockClear())

  it('401 without credentials (the mounted router, no DB touched)', async () => {
    const res = await fetch(`${defaultBase}/admin/errors`)
    expect(res.status).toBe(401)
  })

  it('401 with a wrong token', async () => {
    const res = await fetch(`${base}/admin/errors`, { headers: { 'x-metrics-token': 'nope' } })
    expect(res.status).toBe(401)
    expect(load).not.toHaveBeenCalled()
  })

  it('200 with the read token; query params are parsed and clamped', async () => {
    const res = await fetch(`${base}/admin/errors?days=999&includeResolved=1&kind=server&limit=0`, {
      headers: { 'x-metrics-token': 'errors-test-token' },
    })
    expect(res.status).toBe(200)
    expect(load).toHaveBeenCalledWith({ days: 90, includeResolved: true, kind: 'server', limit: 1 })
  })

  it('defaults: 7 days, unresolved only, both kinds, 100 groups', async () => {
    await fetch(`${base}/admin/errors?kind=bogus`, { headers: { 'x-metrics-token': 'errors-test-token' } })
    expect(load).toHaveBeenCalledWith({ days: 7, includeResolved: false, kind: undefined, limit: 100 })
  })
})

describe('POST /admin/errors/:id/resolve', () => {
  const ID = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f70'

  it('needs an admin JWT: 401 anonymous, and the metrics read token does not open it', async () => {
    const previousToken = env.METRICS_READ_TOKEN
    env.METRICS_READ_TOKEN = 'errors-test-token'
    const app = express()
    app.use(adminErrorsRouter)
    const b = await serve(app)
    expect((await fetch(`${b}/admin/errors/${ID}/resolve`, { method: 'POST' })).status).toBe(401)
    const withToken = await fetch(`${b}/admin/errors/${ID}/resolve`, { method: 'POST', headers: { 'x-metrics-token': 'errors-test-token' } })
    expect(withToken.status).toBe(401)
    env.METRICS_READ_TOKEN = previousToken
  })

  it('as an admin: 400 bad id, 404 unknown, 200 resolved', async () => {
    const asAdmin: RequestHandler = (req, _res, next) => {
      ;(req as any).userId = '11111111-1111-4111-8111-111111111111'
      next()
    }
    const resolve = vi.fn(async (id: string) => (id === ID ? { id, resolvedAt: '2026-10-07T10:00:00.000Z' } : null))
    const app = express()
    app.use(createAdminErrorsRouter({ adminAuth: [asAdmin], resolve: resolve as any }))
    const b = await serve(app)
    expect((await fetch(`${b}/admin/errors/not-a-uuid/resolve`, { method: 'POST' })).status).toBe(400)
    expect((await fetch(`${b}/admin/errors/9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d/resolve`, { method: 'POST' })).status).toBe(404)
    const ok = await fetch(`${b}/admin/errors/${ID}/resolve`, { method: 'POST' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ id: ID, resolvedAt: '2026-10-07T10:00:00.000Z' })
    expect(resolve).toHaveBeenLastCalledWith(ID, '11111111-1111-4111-8111-111111111111')
  })
})
