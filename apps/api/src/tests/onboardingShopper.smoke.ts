/**
 * Smoke (real API + Postgres) for PRO-383: «¿Quién hace la compra?» in the
 * sign-up lands as the `shopper` fact of the household's ficha (only with 2
 * adults or more), records `shopper_answered`, and the WhatsApp sign-up's
 * invitation is a household invitation from the sign-up (`source: alta`,
 * sent) that stamps the sign-up's offer as shown.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/onboardingShopper.smoke.ts
 *
 * Registers its own users (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdInvites, profileChanges, profileFacts, users } from '../db/schema.js'
import { shopperInviteForSignUp } from '../services/shopperInvite.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  return { userId, token: reg.body.token as string, householdId: me.householdId! }
}

async function shopperFacts(householdId: string) {
  return db.select().from(profileFacts).where(and(eq(profileFacts.householdId, householdId), eq(profileFacts.type, 'shopper')))
}

const web = { kidsCount: 0, restrictions: [], cookingStyle: 'daily' }

describe.skipIf(!reachable)('¿Quién hace la compra? (PRO-383)', () => {
  it('web sign-up with 2 adults: the fact about the household, its history row and the event', async () => {
    const { userId, token, householdId } = await register('compra')
    expect((await call('POST', `/user/${userId}/onboarding`, { ...web, adults: 2, shopper: 'shared' }, token)).status).toBe(200)

    const facts = await shopperFacts(householdId)
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ value: { who: 'shared' }, origin: 'onboarding', status: 'active', subjectUserId: null, subjectPersonId: null })
    expect((facts[0].evidence as Array<{ signal: string }>).map((e) => e.signal)).toEqual(['onboarding'])
    const changes = await db.select().from(profileChanges)
      .where(and(eq(profileChanges.householdId, householdId), eq(profileChanges.factType, 'shopper')))
    expect(changes.map((c) => c.action)).toEqual(['fact_added'])

    // The event is fire-and-forget: give it a moment.
    let rows: Array<{ channel: string | null; props: unknown }> = []
    for (let i = 0; i < 20 && rows.length === 0; i++) {
      rows = (await db.execute(sql`SELECT channel, props FROM usage_events WHERE user_id = ${userId}::uuid AND name = 'shopper_answered'`)).rows as any
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 100))
    }
    expect(rows).toEqual([{ channel: 'web', props: { value: 'shared' } }])

    // The ficha reads it in «Tiempo y compra».
    const ficha = await call('GET', '/household/profile', undefined, token)
    expect(JSON.stringify(ficha.body)).toContain('La compra la hacéis por turnos')
  })

  it('web sign-up with 1 adult: nothing is kept even if the answer comes', async () => {
    const { userId, token, householdId } = await register('compra1')
    expect((await call('POST', `/user/${userId}/onboarding`, { ...web, adults: 1, shopper: 'other' }, token)).status).toBe(200)
    expect(await shopperFacts(householdId)).toHaveLength(0)
    expect((await call('POST', `/user/${userId}/onboarding`, { ...web, adults: 2, shopper: 'nadie' }, token)).status).toBe(400)
  })

  it('WhatsApp sign-up: the invitation is from the sign-up, already sent, and the offer is not shown again', async () => {
    const { userId, token, householdId } = await register('compraw')
    await db.update(users).set({ adults: 2 }).where(eq(users.id, userId))
    expect((await call('GET', '/households/me/family-offer', undefined, token)).body.alta).toBe(true)

    const invite = await shopperInviteForSignUp(userId)
    expect(invite).not.toBeNull()
    const token32 = invite!.url.match(/\/invites\/([0-9a-f]{32})$/)?.[1]
    expect(token32).toBeTruthy()
    expect(invite!.message).toBe(`Te he metido en nuestra casa de Mimoia: ahí tendrás el menú y la lista de la compra de cada semana. Entra aquí: ${invite!.url}`)

    const [row] = await db.select().from(householdInvites).where(eq(householdInvites.token, token32!))
    expect(row).toMatchObject({ householdId, source: 'alta', role: 'member' })
    expect(row.sharedAt).not.toBeNull()
    expect((await call('GET', '/households/me/family-offer', undefined, token)).body.alta).toBe(false)

    // Someone who already joined: two accounts, nobody else to invite.
    const other = await register('compraw2')
    expect((await call('POST', `/invites/${token32}/accept`, undefined, other.token)).status).toBe(200)
    expect(await shopperInviteForSignUp(userId)).toBeNull()
  })
})
