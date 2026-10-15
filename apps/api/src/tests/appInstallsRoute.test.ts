/**
 * PRO-83 — GET /admin/metrics carries the two counters (installed app opened,
 * push notifications on) per device. Real metrics router + metricsAuth on an
 * ephemeral port; the database is a stub that answers the two install
 * queries with fixed rows and every other aggregate with no rows.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

vi.mock('../db/connection.js', () => {
  const dialect = new PgDialect()
  const execute = async (q: any) => {
    const text = dialect.sqlToQuery(q).sql
    if (text.includes('FROM push_subscriptions')) {
      return {
        rows: [
          { household_id: 'h1', day: today, user_agent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129 Mobile' },
          { household_id: 'h2', day: today, user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1' },
        ],
      }
    }
    if (text.includes("e.name = 'app_opened_installed'")) {
      return {
        rows: [
          { household_id: 'h1', day: today, device: 'android' },
          { household_id: 'h3', day: today, device: 'ios' },
          { household_id: 'h4', day: today, device: 'desktop' },
        ],
      }
    }
    return { rows: [] }
  }
  return { db: { execute } }
})

const { env } = await import('../config/env.js')
const { default: metricsRouter } = await import('../routes/metrics.js')

let server: Server
let base = ''
const previousToken = env.METRICS_READ_TOKEN

beforeAll(async () => {
  env.METRICS_READ_TOKEN = 'installs-test-token'
  const app = express()
  app.use(metricsRouter)
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

describe('GET /admin/metrics — installed app and push notifications', () => {
  it('returns both counters per device for the current week, numbers only', async () => {
    const res = await fetch(`${base}/admin/metrics?weeks=1`, { headers: { 'x-metrics-token': 'installs-test-token' } })
    expect(res.status).toBe(200)
    const body: any = await res.json()
    const week = body.weekly[body.weekly.length - 1]
    expect(week.installedAppHouseholds).toEqual({ android: 1, ios: 1, desktop: 1, total: 3 })
    expect(week.pushEnabledHouseholds).toEqual({ android: 1, ios: 1, desktop: 0, total: 2 })
    expect(body.definitions.installedAppHouseholds).toBeTruthy()
    expect(body.definitions.pushEnabledHouseholds).toBeTruthy()
    // Aggregates only: no browser strings or household ids leak into the answer.
    const raw = JSON.stringify(body)
    expect(raw).not.toMatch(/Mozilla|iPhone OS|"h1"/)
  })

  it('is closed without credentials', async () => {
    const res = await fetch(`${base}/admin/metrics?weeks=1`)
    expect(res.status).toBe(401)
  })
})
