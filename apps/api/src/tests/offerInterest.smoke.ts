/**
 * Smoke (real API + Postgres) for PRO-389 (D-160): «Que Mimoia se pague sola»
 * shows until the household answers, the answer is `offer_interest` with its
 * two words, it counts once per household (another member's answer is not
 * recorded and the card is gone for them too), and GET /admin/usage counts it
 * in `offerInterest`.
 *
 *   API_URL=… DATABASE_URL=… METRICS_READ_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/offerInterest.smoke.ts
 *
 * Registers its own users (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { users } from '../db/schema.js'

const METRICS_TOKEN = process.env.METRICS_READ_TOKEN ?? ''

async function call(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function register(prefix: string) {
  const u = `${prefix}_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const userId = reg.body.user.id as string
  const [me] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId))
  return { userId, auth: { Authorization: `Bearer ${reg.body.token}` }, householdId: me.householdId! }
}

describe.skipIf(!reachable)('Que Mimoia se pague sola (PRO-389)', () => {
  it('shows until the household answers, once per household, and is counted in /admin/usage', async () => {
    const before = METRICS_TOKEN ? await call('GET', '/admin/usage?days=7', undefined, { 'x-metrics-token': METRICS_TOKEN }) : null
    const a = await register('oferta')
    const b = await register('oferta2')
    // b lives in a's household.
    await db.update(users).set({ primaryHouseholdId: a.householdId }).where(eq(users.id, b.userId))

    expect((await call('GET', '/usage/offer-interest', undefined, a.auth)).body).toEqual({ show: true })
    expect((await call('GET', '/usage/offer-interest', undefined, b.auth)).body).toEqual({ show: true })
    expect((await call('POST', '/usage/offer-interest', { option: 'lidl', where: 'suscripcion' }, a.auth)).status).toBe(400)

    expect((await call('POST', '/usage/offer-interest', { option: 'carrefour', where: 'suscripcion' }, a.auth)).body).toEqual({ counted: true })
    expect((await call('GET', '/usage/offer-interest', undefined, a.auth)).body).toEqual({ show: false })
    expect((await call('GET', '/usage/offer-interest', undefined, b.auth)).body).toEqual({ show: false })
    expect((await call('POST', '/usage/offer-interest', { option: 'tiendas', where: 'precios' }, b.auth)).body).toEqual({ counted: false })

    const rows = (await db.execute(sql`SELECT channel, props FROM usage_events WHERE household_id = ${a.householdId}::uuid AND name = 'offer_interest'`)).rows
    expect(rows).toEqual([{ channel: 'web', props: { option: 'carrefour', where: 'suscripcion' } }])

    if (before) {
      const after = await call('GET', '/admin/usage?days=7', undefined, { 'x-metrics-token': METRICS_TOKEN })
      expect(after.status).toBe(200)
      expect(after.body.offerInterest.totals.carrefour - before.body.offerInterest.totals.carrefour).toBe(1)
      expect(after.body.offerInterest.totals.tiendas - before.body.offerInterest.totals.tiendas).toBe(0)
      expect(after.body.offerInterest.weekly.at(-1)).toMatchObject({ isoWeek: expect.stringMatching(/^\d{4}-W\d{2}$/) })
      expect(JSON.stringify(after.body.offerInterest)).not.toContain(a.householdId)
    }
  })
})
