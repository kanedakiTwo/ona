/**
 * PRO-1018 — GET /admin/metrics → `kFactor` end to end through the SQL
 * loaders: two households share their invitation this week and one new
 * household signs up with one of their codes → 2 shared, 1 sign-up, K = 0,5.
 * The database is a stub that answers the `invite_shared` and invited-sign-up
 * queries with fixed rows and every other one with none.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { madridWeekStart, addDays } from '../services/madridTime.js'

const monday = madridWeekStart(new Date())

vi.mock('../db/connection.js', () => {
  const dialect = new PgDialect()
  const execute = async (q: any) => {
    const text = dialect.sqlToQuery(q).sql
    if (text.includes("e.name = 'invite_shared'")) {
      return {
        rows: [
          { household_id: 'hh-ana', day: monday, count: 1 },
          { household_id: 'hh-luis', day: monday, count: 1 },
        ],
      }
    }
    if (text.includes('u.invited_by_code IS NOT NULL')) {
      return {
        rows: [
          {
            invitee_user_id: 'u-nuevo',
            invitee_household_id: 'hh-nuevo',
            inviter_code: 'anacode1',
            signup_day: monday,
            inviter_user_id: 'u-ana',
            inviter_household_id: 'hh-ana',
          },
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
  env.METRICS_READ_TOKEN = 'k-factor-test-token'
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

const get = async () => {
  const res = await fetch(`${base}/admin/metrics?weeks=2`, { headers: { 'x-metrics-token': 'k-factor-test-token' } })
  expect(res.status).toBe(200)
  return res.json() as Promise<any>
}

describe('GET /admin/metrics — factor K', () => {
  it('2 households share and 1 signs up: the week gives 2 shared, 1 sign-up and K = 0.5', async () => {
    const body = await get()
    const week = body.kFactor.weekly[body.kFactor.weekly.length - 1]
    expect(week).toMatchObject({ week: monday, partial: true, inviteShared: 2, inviteSignups: 1, invitingHouseholds: 2, kFactor: 0.5 })
    expect(week.cumulative).toEqual({ inviteShared: 2, inviteSignups: 1, invitingHouseholds: 2, kFactor: 0.5 })
    expect(body.kFactor.allTime).toEqual({ inviteShared: 2, inviteSignups: 1, invitingHouseholds: 2, kFactor: 0.5 })
  })

  it('the week before reads zero, with K null', async () => {
    const body = await get()
    expect(body.kFactor.weekly[0]).toMatchObject({ week: addDays(monday, -7), partial: false, inviteShared: 0, inviteSignups: 0, kFactor: null })
  })

  it('ships its definition and no ids or codes', async () => {
    const body = await get()
    expect(body.definitions.kFactor).toMatch(/inviteSignups \/ invitingHouseholds/)
    const text = JSON.stringify(body.kFactor)
    expect(text).not.toMatch(/hh-|u-nuevo|u-ana|anacode1/)
  })
})
