/**
 * PRO-246 / PRO-247 — GET /admin/metrics end to end through the SQL loader:
 * `weekly[].menuHouseholds` / `menuReadyByMondayHouseholds` from the menus
 * aggregate (with each household's first creation time for the week), and
 * `eventsByFeature` from the cost aggregate. The database is a stub that
 * answers those two queries with fixed rows and every other one with none.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { madridWeekStart, addDays, madridMidnightUtc } from '../services/madridTime.js'

const monday = madridWeekStart(new Date())
const cutoff = madridMidnightUtc(monday).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

vi.mock('../db/connection.js', () => {
  const dialect = new PgDialect()
  const execute = async (q: any) => {
    const text = dialect.sqlToQuery(q).sql
    if (text.includes('first_created_at')) {
      return {
        rows: [
          { household_id: 'h1', week: monday, first_created_at: new Date(cutoff - 60_000) }, // Sunday 23:59 Madrid
          { household_id: 'h2', week: monday, first_created_at: new Date(cutoff + 60_000) }, // Monday 00:01
          { household_id: 'h3', week: monday, first_created_at: iso(cutoff - 86_400_000) }, // driver returning a string
        ],
      }
    }
    if (text.includes('FROM cost_events ce LEFT JOIN users')) {
      return {
        rows: [
          { week: monday, provider: 'anthropic', feature: 'whatsapp_guided', internal: false, micros: '36000', events: 17, unpriced: 0 },
          { week: monday, provider: 'anthropic', feature: 'assistant_chat', internal: true, micros: '900000', events: 40, unpriced: 0 },
          // PRO-309: no user behind it (catalogue import) → systemCostEur, not costEur.
          { week: monday, provider: 'anthropic', feature: 'catalog_import_rewrite', internal: false, system: true, micros: '2000000', events: 3, unpriced: 0 },
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
  env.METRICS_READ_TOKEN = 'menu-week-test-token'
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

describe('GET /admin/metrics — menus of the week and calls by feature', () => {
  it('counts households with a menu for the week and those ready before Monday 00:00 Madrid', async () => {
    const res = await fetch(`${base}/admin/metrics?weeks=2`, { headers: { 'x-metrics-token': 'menu-week-test-token' } })
    expect(res.status).toBe(200)
    const body: any = await res.json()
    const week = body.weekly[body.weekly.length - 1]
    expect(week.week).toBe(monday)
    expect(week.menuHouseholds).toBe(3)
    expect(week.menuReadyByMondayHouseholds).toBe(2)
    expect(body.weekly[0].week).toBe(addDays(monday, -7))
    expect(body.weekly[0].menuHouseholds).toBe(0)
    expect(body.definitions.menuHouseholds).toBeTruthy()
    expect(body.definitions.menuReadyByMondayHouseholds).toMatch(/Europe\/Madrid/)
  })

  it('carries the number of calls by feature, internal accounts out', async () => {
    const res = await fetch(`${base}/admin/metrics?weeks=1`, { headers: { 'x-metrics-token': 'menu-week-test-token' } })
    const body: any = await res.json()
    expect(body.weekly[0].eventsByFeature).toEqual({ whatsapp_guided: 17 })
    expect(body.totals.eventsByFeature).toEqual({ whatsapp_guided: 17 })
    expect(body.weekly[0].costEur.byFeature.whatsapp_guided).toBeCloseTo(0.036, 6)
    expect(body.weekly[0].costEur.byFeature.catalog_import_rewrite).toBeUndefined()
    expect(body.weekly[0].systemCostEur.byFeature).toEqual({ catalog_import_rewrite: 2 })
    expect(body.totals.systemEventsByFeature).toEqual({ catalog_import_rewrite: 3 })
    expect(body.definitions.systemCostEur).toBeTruthy()
    expect(body.definitions.eventsByFeature).toBeTruthy()
    expect(body.definitions.featureDefinitions.whatsapp_guided).toBeTruthy()
  })

  it('numbers only: no household ids in the answer', async () => {
    const res = await fetch(`${base}/admin/metrics?weeks=1`, { headers: { 'x-metrics-token': 'menu-week-test-token' } })
    expect(JSON.stringify(await res.json())).not.toMatch(/"h[123]"/)
  })
})
