/**
 * API 5xx capture for the in-house error tracker (specs/errors.md): every
 * response ≥ 500 lands in `app_errors` as a `server` group keyed by the route
 * PATTERN — with the real message/stack when the handler logged it via
 * console.error before answering 500 (the common pattern in this codebase) —
 * and responses are never altered. Real Express app on an ephemeral port;
 * the DB sink is replaced by an in-memory one.
 */
import express from 'express'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  captureConsoleErrors,
  captureServerErrors,
  installProcessErrorHandlers,
  observeServerErrors,
} from '../middleware/errorCapture.js'
import {
  resetAppErrorThrottlesForTests,
  setAppErrorSinkForTests,
  type AppErrorRow,
} from '../services/appErrors.js'

const rows: AppErrorRow[] = []
let server: Server
let base: string
let restoreConsole: () => void

beforeAll(async () => {
  setAppErrorSinkForTests({
    upsert: async (row) => {
      rows.push(row)
    },
    bump: async () => {},
  })
  // Silence the handlers' logging, then wrap the silenced console like index.ts does at boot.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  restoreConsole = captureConsoleErrors(console)

  const app = express()
  app.use(observeServerErrors)
  app.use(express.json())
  app.get('/ok', (_req, res) => {
    res.json({ ok: true })
  })
  app.get('/items/:id/caught', (_req, res) => {
    console.error('[items] failed:', new Error('db down after 42 retries'))
    res.status(500).json({ error: 'Internal server error' })
  })
  app.get('/items/:id/logged-text', (_req, res) => {
    console.error('[items] failed:', 'connection refused')
    res.status(500).json({ error: 'Internal server error' })
  })
  app.get('/ai', (_req, res) => {
    res.status(503).json({ error: 'Servicio de IA no disponible' })
  })
  app.get('/throws/:id', () => {
    throw new TypeError('sync boom')
  })
  app.get('/passes', (_req, _res, next) => {
    next(new Error('passed along'))
  })
  app.get('/client-fault', (_req, _res, next) => {
    next(Object.assign(new Error('Unexpected token'), { status: 400, type: 'entity.parse.failed' }))
  })
  app.use(captureServerErrors)
  app.use(errorHandler)
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  restoreConsole()
  vi.restoreAllMocks()
  setAppErrorSinkForTests(null)
  server.closeAllConnections()
  server.close()
})

beforeEach(() => {
  rows.length = 0
  resetAppErrorThrottlesForTests()
})

/** Fetch, then give the `finish` listener a tick to run. */
async function hit(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { headers })
  const body = await res.text()
  await new Promise((r) => setTimeout(r, 20))
  return { status: res.status, body }
}

describe('5xx observer', () => {
  it('2xx and 404 responses are not recorded', async () => {
    await hit('/ok')
    await hit('/nope')
    expect(rows).toEqual([])
  })

  it('a caught-and-logged error is recorded with its real message, stack and route pattern; the response is unchanged', async () => {
    const res = await hit('/items/3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f70/caught?token=secret', {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    })
    expect(res.status).toBe(500)
    expect(JSON.parse(res.body)).toEqual({ error: 'Internal server error' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'server',
      message: 'db down after <n> retries',
      samplePath: 'GET /items/:id/caught',
      userAgentFamily: 'Safari · iOS',
    })
    expect(rows[0].sampleStack).toContain('db down after 42 retries')
    expect(JSON.stringify(rows[0])).not.toContain('secret')
  })

  it('falls back to the logged text when no Error object was logged', async () => {
    await hit('/items/1/logged-text')
    expect(rows[0]).toMatchObject({ message: '[items] failed: connection refused', samplePath: 'GET /items/:id/logged-text' })
  })

  it('a 5xx with nothing logged is recorded from the status and the response error text, grouped by route', async () => {
    await hit('/ai')
    expect(rows[0]).toMatchObject({ message: 'HTTP <n>: Servicio de IA no disponible', samplePath: 'GET /ai' })
  })
})

describe('captureServerErrors (error middleware)', () => {
  it('records a thrown error exactly once and leaves the 500 response as it was', async () => {
    const res = await hit('/throws/7')
    expect(res.status).toBe(500)
    expect(JSON.parse(res.body)).toEqual({ error: 'Internal server error' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ message: 'TypeError: sync boom', samplePath: 'GET /throws/:id' })
  })

  it('records errors handed to next(err)', async () => {
    await hit('/passes')
    expect(rows).toHaveLength(1)
    expect(rows[0].message).toBe('passed along')
  })

  it('skips errors that carry a 4xx status (client fault), even though errorHandler answers 500', async () => {
    const res = await hit('/client-fault')
    expect(res.status).toBe(500) // existing errorHandler behaviour, unchanged
    expect(rows).toEqual([])
  })
})

describe('captureConsoleErrors', () => {
  it('outside a request it only passes the call through', () => {
    const calls: unknown[][] = []
    const fake = { error: (...args: unknown[]) => void calls.push(args) }
    const restore = captureConsoleErrors(fake)
    fake.error('hola', 1)
    expect(calls).toEqual([['hola', 1]])
    restore()
    expect(typeof fake.error).toBe('function')
  })
})

describe('installProcessErrorHandlers', () => {
  it('records unhandled rejections as server errors', async () => {
    const proc = new EventEmitter() as unknown as NodeJS.Process
    installProcessErrorHandlers(proc)
    proc.emit('unhandledRejection', new Error('async boom'), Promise.resolve())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'server', message: 'Unhandled rejection: async boom' })
  })

  it('does not add a second listener when one already exists', () => {
    const proc = new EventEmitter() as unknown as NodeJS.Process
    proc.on('unhandledRejection', () => {})
    installProcessErrorHandlers(proc)
    expect(proc.listenerCount('unhandledRejection')).toBe(1)
  })
})
