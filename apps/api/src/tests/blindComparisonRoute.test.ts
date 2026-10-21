/**
 * GET /admin/menu-planner/comparison (specs/smart-menu.md): the admin view has
 * one line per test household with its id and the reasons as written; the read
 * token gets no household id and no reasons, only how many per week chosen. The
 * guard lets everything through (metricsAuth has its own tests) and the
 * database is a stub that answers by table.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const HOUSEHOLD = '3f2a9c1e-1234-4abc-9def-0123456789ab'

vi.mock('../db/connection.js', async () => {
  const schema = await import('../db/schema.js')
  const rowsFor = (table: unknown) => {
    if (table === schema.users) return [{ id: 'u1' }]
    if (table === schema.menuPlans) return [{ householdId: HOUSEHOLD, status: 'ok', check: { problems: {} }, plannerScore: { score: 0.8 }, generatorScore: { score: 0.7 } }]
    if (table === schema.menuBlindVotes) return [{ householdId: HOUSEHOLD, preferred: 'planner', reason: 'Mi hijo Lucas es celíaco' }]
    return []
  }
  return { db: { select: () => ({ from: (table: unknown) => ({ where: async () => rowsFor(table) }) }) } }
})
vi.mock('../middleware/metricsAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/metricsAuth.js')>()),
  metricsAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const { default: router } = await import('../routes/blindComparison.js')

let server: Server
let base = ''

beforeAll(async () => {
  const app = express()
  app.use(router)
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
})

describe('GET /admin/menu-planner/comparison', () => {
  it('admin view (no token header): household id and reasons as written', async () => {
    const body = await (await fetch(`${base}/admin/menu-planner/comparison`)).json()
    expect(body.households).toHaveLength(1)
    expect(body.households[0]).toMatchObject({ householdId: HOUSEHOLD, reasons: [{ preferred: 'planner', reason: 'Mi hijo Lucas es celíaco' }], votes: { planner: 1, generator: 0, tie: 0 } })
  })

  it('read token: no household id and no reasons, only their count', async () => {
    const body = await (await fetch(`${base}/admin/menu-planner/comparison`, { headers: { 'x-metrics-token': 'any' } })).json()
    expect(body.households[0]).toEqual({
      plans: 1,
      byStatus: { ok: 1 },
      problems: {},
      plannerRules: 80,
      generatorRules: 70,
      votes: { planner: 1, generator: 0, tie: 0 },
      reasonCounts: { planner: 1, generator: 0, tie: 0 },
      prefersPlanner: true,
    })
    expect(JSON.stringify(body)).not.toMatch(/3f2a9c1e|Lucas|celíaco/)
  })
})
