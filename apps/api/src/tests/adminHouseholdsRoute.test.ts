/**
 * PRO-1290 — `PUT /admin/households/:id/mimo-cap` on a real Express app with
 * the service faked (the SQL and the audit row are in adminFixes.smoke.ts),
 * and the 3× ceiling (services/householdMimoCap.ts).
 */
import express, { type RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { env } from '../config/env.js'
import adminHouseholdsRouter, { createAdminHouseholdsRouter, type AdminHouseholdsDeps } from '../routes/adminHouseholds.js'
import { maxMimoCapEur, planMimoCapEur, setHouseholdMimoCap } from '../services/householdMimoCap.js'

const ADMIN = '11111111-1111-4111-8111-111111111111'
const HOUSE = '22222222-2222-4222-8222-222222222222'

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

const asAdmin: RequestHandler = (req, _res, next) => {
  ;(req as any).userId = ADMIN
  next()
}

async function app(over: Partial<AdminHouseholdsDeps> = {}) {
  const deps = {
    adminAuth: [asAdmin],
    setMimoCap: vi.fn(async (householdId: string, capEur: number | null) =>
      householdId === HOUSE
        ? { ok: true as const, householdId, capEur, previousEur: null, planCapEur: 6, maxEur: 18, changed: true }
        : { ok: false as const, code: 'NOT_FOUND' as const },
    ),
    ...over,
  }
  const a = express()
  a.use(createAdminHouseholdsRouter(deps))
  return { base: await serve(a), deps }
}

const put = (base: string, id: string, body: unknown) =>
  fetch(`${base}/admin/households/${id}/mimo-cap`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('PUT /admin/households/:id/mimo-cap', () => {
  it('needs an admin JWT (401 anonymous)', async () => {
    const a = express()
    a.use(adminHouseholdsRouter)
    const r = await put(await serve(a), HOUSE, { capEur: 12 })
    expect(r.status).toBe(401)
  })

  it('sets the cap with the admin id (cents rounded) and answers the before and the ceiling', async () => {
    const { base, deps } = await app()
    const r = await put(base, HOUSE, { capEur: 12.345 })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ householdId: HOUSE, capEur: 12.35, previousEur: null, planCapEur: 6, maxEur: 18, changed: true })
    expect(deps.setMimoCap).toHaveBeenCalledWith(HOUSE, 12.35, ADMIN)
  })

  it('null takes it back to the plan’s', async () => {
    const { base, deps } = await app()
    expect((await put(base, HOUSE, { capEur: null })).status).toBe(200)
    expect(deps.setMimoCap).toHaveBeenLastCalledWith(HOUSE, null, ADMIN)
  })

  it('400 TOO_HIGH over 3× the plan, with the figures', async () => {
    const { base } = await app({ setMimoCap: vi.fn(async () => ({ ok: false as const, code: 'TOO_HIGH' as const, maxEur: 18, planCapEur: 6 })) })
    const r = await put(base, HOUSE, { capEur: 19 })
    expect(r.status).toBe(400)
    const j = await r.json()
    expect(j).toMatchObject({ code: 'TOO_HIGH', maxEur: 18, planCapEur: 6 })
    expect(j.error).toContain('18')
  })

  it('400 for a missing, zero, negative or text cap or an unknown field; 404 for a bad id or an unknown household', async () => {
    const { base, deps } = await app()
    for (const bad of [{}, { capEur: 0 }, { capEur: -5 }, { capEur: '12' }, { capEur: 12, reason: 'x' }]) {
      const r = await put(base, HOUSE, bad)
      expect(r.status, JSON.stringify(bad)).toBe(400)
      expect((await r.json()).code).toBe('INVALID_CAP')
    }
    expect(deps.setMimoCap).not.toHaveBeenCalled()
    expect((await put(base, 'casa', { capEur: 12 })).status).toBe(404)
    expect((await put(base, '33333333-3333-4333-8333-333333333333', { capEur: 12 })).status).toBe(404)
  })
})

describe('the ceiling', () => {
  it('is 3 times the plan’s cap (the general Mimo cap until per-plan caps)', () => {
    expect(planMimoCapEur()).toBe(env.ADVISOR_MONTHLY_BUDGET_EUR)
    expect(maxMimoCapEur(6)).toBe(18)
    expect(maxMimoCapEur(4.99)).toBe(14.97)
  })

  it('a cap over it is refused before touching the database', async () => {
    const r = await setHouseholdMimoCap(HOUSE, maxMimoCapEur() + 0.01, ADMIN)
    expect(r).toEqual({ ok: false, code: 'TOO_HIGH', maxEur: maxMimoCapEur(), planCapEur: planMimoCapEur() })
  })
})

describe('the caps follow the household (members of it)', () => {
  /** A db whose household lookup answers `cap` (or throws). */
  const dbWith = (cap: number | null | Error): any => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: async () => {
        if (cap instanceof Error) throw cap
        return [{ cap }]
      },
    }
    return { select: () => chain }
  }

  it('Mimo’s budget: the person’s own cap, else the household’s, else the general one', async () => {
    const { budgetMicrosFor } = await import('../services/advisorBudget.js')
    const original = env.USER_CAP_OVERRIDES_EUR
    try {
      env.USER_CAP_OVERRIDES_EUR = ''
      expect(await budgetMicrosFor(ADMIN, dbWith(15))).toBe(15_000_000)
      expect(await budgetMicrosFor(ADMIN, dbWith(null))).toBe(Math.round(env.ADVISOR_MONTHLY_BUDGET_EUR * 1_000_000))
      expect(await budgetMicrosFor(ADMIN, dbWith(new Error('caída')))).toBe(Math.round(env.ADVISOR_MONTHLY_BUDGET_EUR * 1_000_000))
      env.USER_CAP_OVERRIDES_EUR = `${ADMIN}:20`
      expect(await budgetMicrosFor(ADMIN, dbWith(15))).toBe(20_000_000)
    } finally {
      env.USER_CAP_OVERRIDES_EUR = original
    }
  })

  it('all paid AI: raised to the household’s Mimo cap, never lowered', async () => {
    const { spendCapStatus } = await import('../services/spendCap.js')
    const general = env.USER_MONTHLY_SPEND_CAP_EUR
    env.USER_MONTHLY_SPEND_CAP_EUR = 10
    const spent = async () => 12
    try {
      expect(await spendCapStatus(ADMIN, { spent, db: dbWith(15) })).toMatchObject({ exceeded: false, capEur: 15 })
      expect(await spendCapStatus(ADMIN, { spent, db: dbWith(4) })).toMatchObject({ exceeded: true, capEur: 10 })
      expect(await spendCapStatus(ADMIN, { spent, db: dbWith(null) })).toMatchObject({ exceeded: true, capEur: 10 })
    } finally {
      env.USER_MONTHLY_SPEND_CAP_EUR = general
    }
  })
})
