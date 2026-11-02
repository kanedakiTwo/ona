/**
 * Smoke (real API + Postgres) for PRO-1090 (D-148), «saber cuándo un usuario
 * llega al tope de gasto de Mimo»:
 *   - the second 429 of the month doesn't create another `cap_hits` row;
 *   - `capHits` counts them by cap (asistente / ia) and channel (app / whatsapp);
 *   - an admin is exempt: no row.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/capHits.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { capHits, costEvents, users } from '../db/schema.js'
import { currentMonthKey } from '../services/advisorBudget.js'
import { loadCapHits } from '../services/capHits.js'
import { runWithCostUser } from '../services/costLedger.js'
import { buildInboundDeps } from '../services/whatsapp/wiring.js'

const tag = `cap${Date.now()}${Math.random().toString(36).slice(2, 6)}`

async function call(method: string, path: string, token?: string, payload?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function register(i: number) {
  const u = `${tag}${i}`
  const reg = await call('POST', '/register', undefined, { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status, JSON.stringify(reg.body)).toBe(201)
  return { id: reg.body.user.id as string, token: reg.body.token as string }
}

/** Mimo's own € budget already spent this month (ADVISOR_BUDGET_EXCEEDED). */
const spendAdvisor = (userId: string) =>
  db.update(users).set({ advisorSpendMicros: 999_000_000, advisorSpendMonthKey: currentMonthKey() }).where(eq(users.id, userId))

/** The whole-AI cap already spent this month (SPEND_CAP_EXCEEDED). */
const spendAll = (userId: string) =>
  db.insert(costEvents).values({ userId, feature: 'assistant_chat', provider: 'anthropic', model: 'smoke', costMicros: 999_000_000 })

const chat = (u: { id: string; token: string }) => call('POST', `/assistant/${u.id}/chat`, u.token, { message: 'hola' })
const rowsOf = (userId: string) => db.select().from(capHits).where(eq(capHits.userId, userId))
const whatsappBudget = (userId: string) => runWithCostUser(null, () => buildInboundDeps().checkBudget(userId), 'whatsapp')

describe.skipIf(!reachable)('cap_hits (PRO-1090)', () => {
  it('app: the second 429 of the month does not add a row, and capHits counts by cap and channel', async () => {
    const before = await loadCapHits()

    const mimo = await register(1)
    await spendAdvisor(mimo.id)
    const first = await chat(mimo)
    expect(first.status).toBe(429)
    expect(first.body.code).toBe('ADVISOR_BUDGET_EXCEEDED')
    expect((await chat(mimo)).status).toBe(429)
    const rows = await rowsOf(mimo.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ cap: 'asistente', channel: 'app', capMicros: Math.round(env.ADVISOR_MONTHLY_BUDGET_EUR * 1_000_000) })
    expect(rows[0].householdId).toBeTruthy()

    const ia = await register(2)
    await spendAll(ia.id)
    const capped = await chat(ia)
    expect(capped.status).toBe(429)
    expect(capped.body.code).toBe('SPEND_CAP_EXCEEDED')
    expect((await chat(ia)).status).toBe(429)
    expect(await rowsOf(ia.id)).toHaveLength(1)

    const wa = await register(3)
    await spendAll(wa.id)
    expect((await whatsappBudget(wa.id)).exceeded).toBe(true)
    expect((await whatsappBudget(wa.id)).exceeded).toBe(true)
    expect(await rowsOf(wa.id)).toMatchObject([{ cap: 'ia', channel: 'whatsapp' }])

    const after = await loadCapHits()
    expect(after.total - before.total).toBe(3)
    expect(after.porTope.asistente - before.porTope.asistente).toBe(1)
    expect(after.porTope.ia - before.porTope.ia).toBe(2)
    expect(after.porCanal.app - before.porCanal.app).toBe(2)
    expect(after.porCanal.whatsapp - before.porCanal.whatsapp).toBe(1)
    expect(after.ultimos7d - before.ultimos7d).toBe(3)
    const mine = after.lista.find((h) => h.hogar === rows[0].householdId!.slice(0, 8))
    expect(mine).toMatchObject({ tope: 'asistente', canal: 'app', topeEur: env.ADVISOR_MONTHLY_BUDGET_EUR, gastadoEur: 999, plan: 'ninguno' })
  })

  it('an admin is exempt: no row, in the app or by WhatsApp', async () => {
    const admin = await register(4)
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id))
    await spendAdvisor(admin.id)
    // Mimo's own budget still answers 429 to an admin; it just isn't counted.
    expect((await chat(admin)).status).toBe(429)
    await whatsappBudget(admin.id)
    expect(await rowsOf(admin.id)).toHaveLength(0)
  })
})
