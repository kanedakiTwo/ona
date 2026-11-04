/**
 * PRO-1101 (D-156): la API de Anthropic sin saldo, con el error simulado (el
 * 400 «credit balance is too low» tal como lo da el SDK):
 *   - se reconoce (el error del SDK y la línea de log) y no se confunde con otros;
 *   - se apunta una vez por hora; la primera respuesta buena cierra la racha;
 *   - los logs de cualquier llamada (console.error / console.warn) también lo apuntan;
 *   - `/admin/metrics` → `apiSaldo: { sinSaldoDesde, ultimoError }` (con el token);
 *   - en la app, Mimo contesta `API_SALDO_REPLY` (200) en vez del 500 genérico.
 * WhatsApp, en whatsappInbound.test.ts; la base de datos real, en apiSaldo.smoke.ts.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

/** La fila del grupo `saldo_api` que devuelve la base de mentira (null: no hay). */
let saldoRow: Record<string, unknown> | null = null

vi.mock('../db/connection.js', () => {
  const dialect = new PgDialect()
  const execute = async (q: any) => {
    const text = dialect.sqlToQuery(q).sql
    if (text.includes('SELECT first_seen, last_seen, resolved_at FROM app_errors')) return { rows: saldoRow ? [saldoRow] : [] }
    return { rows: [] }
  }
  const db = {
    execute,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ householdId: 'h-1', name: 'x', authorId: null }] }) }) }),
    insert: () => ({ values: async () => {} }),
  }
  return { db, pool: {} }
})
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 'u-1'
    next()
  },
}))
vi.mock('../middleware/spendCap.js', () => ({ requireSpendCapacity: () => (_req: any, _res: any, next: any) => next() }))
vi.mock('../services/advisorBudget.js', () => ({
  checkAdvisorBudget: async () => ({ exceeded: false, budgetMicros: 5_000_000 }),
  recordAdvisorUsage: async () => {},
}))
const chatMock = vi.fn()
vi.mock('../services/assistant/engine.js', () => ({ chat: chatMock }))

const {
  API_SALDO_REPLY,
  isApiBalanceError,
  noteApiBalanceError,
  noteApiCallOk,
  setApiSaldoWriterForTests,
} = await import('../services/apiSaldo.js')
const { watchApiBalanceLogs } = await import('../middleware/errorCapture.js')

/** El error tal como lo lanza el SDK cuando la cuenta se queda sin saldo. */
function creditError(): Error {
  return new Anthropic.BadRequestError(
    400,
    {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      },
    },
    undefined,
    new Headers(),
  )
}

const HOUR = 60 * 60 * 1000
const T0 = Date.parse('2026-11-03T15:00:00Z')

function fakeWriter() {
  const w = { record: vi.fn(async (_now: Date) => true), close: vi.fn(async (_now: Date) => true) }
  setApiSaldoWriterForTests(w)
  return w
}

afterEach(() => setApiSaldoWriterForTests(null))

describe('isApiBalanceError', () => {
  it('el 400 de saldo del SDK, y su texto en un log', () => {
    const err = creditError()
    expect(isApiBalanceError(err)).toBe(true)
    expect(isApiBalanceError(err.message)).toBe(true)
    expect(isApiBalanceError({ error: { error: { message: 'Your credit balance is too low to access the Anthropic API.' } } })).toBe(true)
  })

  it('otros errores no', () => {
    expect(isApiBalanceError(new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'messages: field required' } }, undefined, new Headers()))).toBe(false)
    expect(isApiBalanceError(new Error('Anthropic down'))).toBe(false)
    expect(isApiBalanceError(null)).toBe(false)
    expect(isApiBalanceError(429)).toBe(false)
  })
})

describe('noteApiBalanceError: una vez por hora', () => {
  it('apunta el primero, no los de la misma hora, y otra vez pasada la hora', () => {
    const w = fakeWriter()
    expect(noteApiBalanceError(creditError(), T0)).toBe(true)
    expect(noteApiBalanceError(creditError(), T0 + 10 * 60 * 1000)).toBe(true)
    expect(noteApiBalanceError(creditError(), T0 + HOUR - 1)).toBe(true)
    expect(w.record).toHaveBeenCalledTimes(1)
    expect(noteApiBalanceError(creditError(), T0 + HOUR)).toBe(true)
    expect(w.record).toHaveBeenCalledTimes(2)
    expect(w.record.mock.calls.map(([d]) => d.getTime())).toEqual([T0, T0 + HOUR])
  })

  it('otro error ni se apunta ni cambia la respuesta', () => {
    const w = fakeWriter()
    expect(noteApiBalanceError(new Error('Anthropic down'), T0)).toBe(false)
    expect(w.record).not.toHaveBeenCalled()
  })

  it('la primera respuesta buena cierra la racha, una sola vez, y el siguiente fallo se apunta ya', () => {
    const w = fakeWriter()
    noteApiCallOk(T0)
    expect(w.close).not.toHaveBeenCalled() // sin racha, nada
    noteApiBalanceError(creditError(), T0)
    noteApiCallOk(T0 + 60_000)
    noteApiCallOk(T0 + 120_000)
    expect(w.close).toHaveBeenCalledTimes(1)
    noteApiBalanceError(creditError(), T0 + 180_000)
    expect(w.record).toHaveBeenCalledTimes(2)
  })

  it('tras un arranque, la primera respuesta buena mira si quedó una racha abierta', () => {
    const w = { record: vi.fn(async () => true), close: vi.fn(async () => true) }
    setApiSaldoWriterForTests(w, { streakMaybeOpen: true })
    noteApiCallOk(T0)
    expect(w.close).toHaveBeenCalledTimes(1)
  })

  it('un fallo al escribir no sale de aquí', async () => {
    setApiSaldoWriterForTests({ record: async () => { throw new Error('db down') }, close: async () => true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(noteApiBalanceError(creditError(), T0)).toBe(true)
    await new Promise((r) => setImmediate(r))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('watchApiBalanceLogs', () => {
  it('apunta el fallo de saldo que cualquier llamada deja en console.error o console.warn, sin cambiar la salida', () => {
    const out: unknown[][] = []
    const target = { error: (...a: unknown[]) => void out.push(a), warn: (...a: unknown[]) => void out.push(a) }
    const note = vi.fn(() => true)
    const restore = watchApiBalanceLogs(target as any, note)
    target.warn('[menuFit] failed (continuing):', creditError())
    target.error('[catalog] rewrite failed:', creditError().message)
    target.error('[x] otro fallo', new Error('boom'))
    expect(note).toHaveBeenCalledTimes(2)
    expect(out).toHaveLength(3)
    restore()
    target.warn(creditError())
    expect(note).toHaveBeenCalledTimes(2)
  })
})

describe('rutas', () => {
  let server: Server
  let base = ''
  let previousToken = ''

  beforeAll(async () => {
    const { env } = await import('../config/env.js')
    const { default: metricsRouter } = await import('../routes/metrics.js')
    const { default: assistantRouter } = await import('../routes/assistant.js')
    previousToken = env.METRICS_READ_TOKEN
    env.METRICS_READ_TOKEN = 'api-saldo-test-token'
    const app = express()
    app.use(express.json())
    app.use(metricsRouter)
    app.use(assistantRouter)
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    const { env } = await import('../config/env.js')
    env.METRICS_READ_TOKEN = previousToken
    server?.closeAllConnections()
    server?.close()
  })

  const metrics = async () => {
    const res = await fetch(`${base}/admin/metrics?weeks=1`, { headers: { 'x-metrics-token': 'api-saldo-test-token' } })
    expect(res.status).toBe(200)
    return ((await res.json()) as any).apiSaldo
  }

  it('/admin/metrics → apiSaldo: sin saldo desde el principio de la racha abierta', async () => {
    saldoRow = { first_seen: new Date('2026-11-03T14:00:00Z'), last_seen: new Date('2026-11-03T16:00:00Z'), resolved_at: null }
    expect(await metrics()).toEqual({ sinSaldoDesde: '2026-11-03T14:00:00.000Z', ultimoError: '2026-11-03T16:00:00.000Z' })
  })

  it('/admin/metrics → apiSaldo: racha cerrada (vuelve a haber saldo) y nunca', async () => {
    saldoRow = { first_seen: new Date('2026-11-03T14:00:00Z'), last_seen: new Date('2026-11-03T16:00:00Z'), resolved_at: new Date('2026-11-03T17:00:00Z') }
    expect(await metrics()).toEqual({ sinSaldoDesde: null, ultimoError: '2026-11-03T16:00:00.000Z' })
    saldoRow = null
    expect(await metrics()).toEqual({ sinSaldoDesde: null, ultimoError: null })
  })

  const send = () =>
    fetch(`${base}/assistant/u-1/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hola' }) })

  it('app: sin saldo, Mimo contesta su texto propio (y queda apuntado)', async () => {
    const w = fakeWriter()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    chatMock.mockRejectedValueOnce(creditError())
    const res = await send()
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.message).toBe(API_SALDO_REPLY)
    expect(body.message).toBe('Ahora mismo no puedo contestarte; lo estamos arreglando. Vuelve a escribirme en un rato.')
    expect(w.record).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })

  it('app: otro fallo sigue siendo el 500 de siempre', async () => {
    const w = fakeWriter()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    chatMock.mockRejectedValueOnce(new Error('Anthropic down'))
    const res = await send()
    expect(res.status).toBe(500)
    expect(w.record).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
