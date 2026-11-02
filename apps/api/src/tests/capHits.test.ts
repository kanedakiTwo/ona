/**
 * PRO-1090 (D-148): `capHits` en GET /admin/metrics — la primera vez de cada
 * usuario y mes (Madrid) que salta un tope de gasto, por tope y por canal,
 * sin nombres ni textos. Aquí, la parte pura, la ruta con el token (base de
 * datos de mentira) y que el middleware del tope de la IA lo anota (y no para
 * un admin). La base real, en capHits.smoke.ts.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const NOW = new Date()

vi.mock('../db/connection.js', () => {
  const dialect = new PgDialect()
  const execute = async (q: any) => {
    const text = dialect.sqlToQuery(q).sql
    if (text.includes('FROM cap_hits ch')) {
      const { madridMonthKey } = await import('../services/capHits.js')
      return {
        rows: [
          { household_id: 'aaaaaaaa-1111-2222-3333-444444444444', month: madridMonthKey(NOW), cap: 'asistente', channel: 'whatsapp', spent_micros: '5020000', cap_micros: '5000000', created_at: NOW, plan: 'plus' },
          { household_id: 'bbbbbbbb-1111-2222-3333-444444444444', month: madridMonthKey(NOW), cap: 'ia', channel: 'app', spent_micros: '10400000', cap_micros: '10000000', created_at: NOW, plan: null },
        ],
      }
    }
    return { rows: [] }
  }
  return { db: { execute }, pool: {} }
})

const { buildCapHits, madridMonthKey } = await import('../services/capHits.js')
const { requireSpendCapacity } = await import('../middleware/spendCap.js')

const DAY = 24 * 60 * 60 * 1000

describe('buildCapHits', () => {
  const now = new Date('2026-11-20T10:00:00Z')
  const row = (cap: 'asistente' | 'ia', channel: 'app' | 'whatsapp', at: Date, month = '2026-11') => ({
    householdId: '12345678-aaaa-bbbb-cccc-dddddddddddd',
    plan: null,
    cap,
    channel,
    spentMicros: 5_023_456,
    capMicros: 5_000_000,
    createdAt: at,
    month,
  })

  it('cuenta el mes por tope y por canal, y los últimos 7 días aparte', () => {
    const out = buildCapHits(
      [
        row('asistente', 'app', new Date(now.getTime() - 1 * DAY)),
        row('asistente', 'whatsapp', new Date(now.getTime() - 10 * DAY)),
        row('ia', 'whatsapp', new Date(now.getTime() - 2 * DAY)),
        // Del mes pasado pero en los últimos 7 días (p. ej. el día 3): solo cuenta en ultimos7d.
        row('ia', 'app', new Date(now.getTime() - 3 * DAY), '2026-10'),
      ],
      now,
    )
    expect(out).toMatchObject({
      mes: '2026-11',
      total: 3,
      porTope: { asistente: 2, ia: 1 },
      porCanal: { app: 1, whatsapp: 2 },
      ultimos7d: 3,
    })
    expect(out.lista).toHaveLength(3)
    // Lo más reciente primero; del hogar, solo 8 caracteres; euros con 2 decimales.
    expect(out.lista[0]).toEqual({
      hogar: '12345678',
      plan: 'ninguno',
      tope: 'asistente',
      gastadoEur: 5.02,
      topeEur: 5,
      canal: 'app',
      en: new Date(now.getTime() - DAY).toISOString(),
    })
  })

  it('sin filas, todo a cero', () => {
    expect(buildCapHits([], now)).toEqual({
      mes: '2026-11', total: 0, porTope: { asistente: 0, ia: 0 }, porCanal: { app: 0, whatsapp: 0 }, ultimos7d: 0, lista: [],
    })
  })

  it('el mes es el de Madrid', () => {
    // 31-oct 23:30 UTC = 1-nov 00:30 en Madrid.
    expect(madridMonthKey(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11')
  })
})

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (c: number) => ((res.statusCode = c), res)
  res.json = (b: unknown) => ((res.body = b), res)
  return res
}

describe('requireSpendCapacity anota el tope de la IA', () => {
  const over = async () => ({ exceeded: true, spentEur: 10.4, capEur: 10 })

  it('un usuario: el 429 deja su intento con tope ia y canal app', async () => {
    const record = vi.fn(async () => true)
    const res = fakeRes()
    await requireSpendCapacity(over, record)({ userId: 'u', user: { role: 'user' } } as any, res, vi.fn())
    expect(res.statusCode).toBe(429)
    expect(record).toHaveBeenCalledWith({ userId: 'u', cap: 'ia', spentEur: 10.4, capEur: 10, channel: 'app' })
  })

  it('un admin está exento: ni 429 ni fila', async () => {
    const record = vi.fn(async () => true)
    const next = vi.fn()
    await requireSpendCapacity(over, record)({ userId: 'a', user: { role: 'admin' } } as any, fakeRes(), next)
    expect(next).toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('el texto que ve el usuario no cambia', async () => {
    const res = fakeRes()
    await requireSpendCapacity(over, async () => true)({ userId: 'u', user: { role: 'user' } } as any, res, vi.fn())
    expect(res.body.error).toBe('Has llegado al límite de uso de la IA de este mes (10 €). Se renueva el día 1.')
  })
})

describe('GET /admin/metrics → capHits (con x-metrics-token)', () => {
  let server: Server
  let base = ''
  let previousToken = ''

  beforeAll(async () => {
    const { env } = await import('../config/env.js')
    const { default: metricsRouter } = await import('../routes/metrics.js')
    previousToken = env.METRICS_READ_TOKEN
    env.METRICS_READ_TOKEN = 'cap-hits-test-token'
    const app = express()
    app.use(metricsRouter)
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

  it('da la forma que lee la oficina, sin nombres ni ids completos', async () => {
    const res = await fetch(`${base}/admin/metrics?weeks=1`, { headers: { 'x-metrics-token': 'cap-hits-test-token' } })
    expect(res.status).toBe(200)
    const { capHits } = (await res.json()) as any
    expect(capHits).toEqual({
      mes: madridMonthKey(NOW),
      total: 2,
      porTope: { asistente: 1, ia: 1 },
      porCanal: { app: 1, whatsapp: 1 },
      ultimos7d: 2,
      lista: [
        { hogar: 'aaaaaaaa', plan: 'plus', tope: 'asistente', gastadoEur: 5.02, topeEur: 5, canal: 'whatsapp', en: NOW.toISOString() },
        { hogar: 'bbbbbbbb', plan: 'ninguno', tope: 'ia', gastadoEur: 10.4, topeEur: 10, canal: 'app', en: NOW.toISOString() },
      ],
    })
  })
})
