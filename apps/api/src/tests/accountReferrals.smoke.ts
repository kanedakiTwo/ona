/**
 * Smoke (real API + Postgres) for PRO-162 «Invitar a otro hogar»
 * (specs/waitlist.md, specs/auth.md): the account's code and link, and what
 * a sign-up with `invitedBy` stores.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/accountReferrals.smoke.ts
 *
 * Needs REGISTRATION_MODE=open (CI's smoke job sets it); skips when the API
 * isn't reachable.
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { users } from '../db/schema.js'

const tag = `ref${Date.now()}${Math.random().toString(36).slice(2, 6)}`

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

let n = 0
async function register(extra: Record<string, unknown> = {}, email?: string) {
  const u = `${tag}${++n}`
  const reg = await call('POST', '/register', { username: u, email: email ?? `${u}@test.local`, password: 'e2epass123', ageConfirmed: true, ...extra })
  expect(reg.status, JSON.stringify(reg.body)).toBe(201)
  return { id: reg.body.user.id as string, token: reg.body.token as string }
}

async function stored(id: string) {
  const [row] = await db
    .select({ invitedByCode: users.invitedByCode, signupAttribution: users.signupAttribution, referralCode: users.referralCode })
    .from(users)
    .where(eq(users.id, id))
  return row
}

function waitlist(email: string) {
  return call('POST', '/waitlist', {
    email,
    firstName: 'Smoke',
    householdSize: '2',
    plannerRole: 'yo',
    currentMethod: 'improviso',
    platform: 'ios',
    supermarket: null,
    wantsWhatsapp: false,
    newsletterOptIn: false,
    consent: true,
    website: '',
    source: 'smoke',
    referredByCode: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
  })
}

describe.skipIf(!reachable)('«Invitar a otro hogar» (PRO-162)', () => {
  it('an account gets its code and link; a sign-up with it stores the inviter and the attribution', async () => {
    const ana = await register()
    const me = await call('GET', '/referrals/me', undefined, ana.token)
    expect(me.status).toBe(200)
    expect(me.body.code).toMatch(/^[0-9a-z]{8}$/)
    expect(me.body.link).toMatch(new RegExp(`/\\?invita=${me.body.code}$`))
    expect((await call('GET', '/referrals/me', undefined, ana.token)).body.code).toBe(me.body.code)

    const bea = await register({ invitedBy: me.body.code.toUpperCase(), signupSource: 'circulo-miguel', utmSource: 'whatsapp' })
    const row = await stored(bea.id)
    expect(row.invitedByCode).toBe(me.body.code)
    expect(row.signupAttribution).toEqual({ source: 'circulo-miguel', utmSource: 'whatsapp', utmMedium: null, utmCampaign: null })
    expect(row.referralCode).toMatch(/^[0-9a-z]{8}$/)
  }, 30_000)

  it('a waitlist person’s code counts too, and their account keeps that code', async () => {
    const listEmail = `${tag}list@test.local`
    const signup = await waitlist(listEmail)
    expect(signup.status).toBeLessThan(300)
    const listCode = signup.body.code as string

    const carla = await register({ invitedBy: listCode })
    expect((await stored(carla.id)).invitedByCode).toBe(listCode)

    // The list person signs up: same code, and inviting themselves stores nothing.
    const self = await register({ invitedBy: listCode }, listEmail)
    const row = await stored(self.id)
    expect(row.referralCode).toBe(listCode)
    expect(row.invitedByCode).toBeNull()
  }, 30_000)

  it('an unknown or malformed code signs up normally, without an inviter', async () => {
    const a = await register({ invitedBy: 'zzzzzzzz' })
    expect((await stored(a.id)).invitedByCode).toBeNull()
    const b = await register({ invitedBy: '<script>' })
    expect((await stored(b.id)).invitedByCode).toBeNull()
  }, 30_000)
})
