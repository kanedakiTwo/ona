/**
 * Smoke (real API + Postgres) for PRO-353 (D-130, specs/billing.md): the
 * household created by someone who came with a creator's link (`cr-…`, on the
 * account or on their waitlist row) has 4 weeks free in all; in the beta,
 * counted from launch day (first charge on 12 January 2027).
 *
 * Runs in CI's smoke job (`scripts/test-smoke.sh` locally).
 *
 * Needs REGISTRATION_MODE=open (CI's smoke job sets it); skips when the API
 * isn't reachable. Written for the beta (before 2026-12-15).
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdMembers, households, users, waitlistEntries } from '../db/schema.js'
import { hashInviteToken, waitlistInviteToken } from '../services/waitlistInvites.js'

const tag = `crt${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const inBeta = Date.now() < Date.parse('2026-12-15T00:00:00+01:00')

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

/** A throwaway address on the test domain. */
function testEmail(name: string): string {
  return tag + name + '@test.local'
}

let n = 0
async function register(extra: Record<string, unknown> = {}, email?: string) {
  const u = `${tag}${++n}`
  const reg = await call('POST', '/register', { username: u, email: email ?? testEmail(String(n)), password: 'e2epass123', ageConfirmed: true, ...extra })
  expect(reg.status, JSON.stringify(reg.body)).toBe(201)
  return { id: reg.body.user.id as string, token: reg.body.token as string }
}

async function trial(token: string) {
  const r = await call('GET', '/billing', undefined, token)
  expect(r.status).toBe(200)
  return { trialDays: r.body.access.trialDays as number, firstChargeAt: r.body.firstChargeAt as string }
}

async function primaryHousehold(userId: string): Promise<string> {
  const [u] = await db.select({ h: users.primaryHouseholdId }).from(users).where(eq(users.id, userId))
  return u.h!
}

function joinWaitlist(email: string, source: string) {
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
    source,
    referredByCode: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
  })
}

/** What the admin's «Invitar» does (PRO-97): the row goes `invited` with a one-time link. */
async function inviteFromWaitlist(email: string): Promise<string> {
  const [row] = await db.select({ id: waitlistEntries.id }).from(waitlistEntries).where(eq(waitlistEntries.email, email))
  expect(row, 'waitlist row').toBeTruthy()
  const token = waitlistInviteToken(row.id)
  await db
    .update(waitlistEntries)
    .set({ status: 'invited', invitedAt: new Date(), inviteTokenHash: hashInviteToken(token) })
    .where(eq(waitlistEntries.id, row.id))
  return token
}

describe.skipIf(!reachable || !inBeta)('4 weeks free with a creator link (PRO-353)', () => {
  it('signing up with `signupSource: "cr-prueba"`: 28 days, first charge on 12 January; without it, 14 and 29 December', async () => {
    const withLink = await register({ signupSource: 'cr-prueba' })
    expect(await trial(withLink.token)).toEqual({ trialDays: 28, firstChargeAt: '2027-01-12T11:00:00.000Z' })
    const without = await register()
    expect(await trial(without.token)).toEqual({ trialDays: 14, firstChargeAt: '2026-12-29T11:00:00.000Z' })
  })

  it('`ref=crema` or `ref=cr` give nothing', async () => {
    for (const signupSource of ['crema', 'cr']) {
      const u = await register({ signupSource })
      expect((await trial(u.token)).trialDays, signupSource).toBe(14)
    }
  })

  it('joined the waitlist with `cr-prueba`, came in from the invitation without a ref in the URL: 28 days', async () => {
    const email = testEmail('wl')
    expect((await joinWaitlist(email, 'cr-prueba')).status).toBe(200)
    const waitlistToken = await inviteFromWaitlist(email)
    const u = await register({ waitlistToken }, email)
    const [stored] = await db.select({ a: users.signupAttribution }).from(users).where(eq(users.id, u.id))
    expect(stored.a?.source ?? null).toBeNull()
    expect(await trial(u.token)).toEqual({ trialDays: 28, firstChargeAt: '2027-01-12T11:00:00.000Z' })

    // A waitlist row with another ref: nothing.
    const other = testEmail('wl2')
    expect((await joinWaitlist(other, 'crema')).status).toBe(200)
    const plain = await register({ waitlistToken: await inviteFromWaitlist(other) }, other)
    expect((await trial(plain.token)).trialDays).toBe(14)
  })

  it('someone with the link who joins (or inherits) an existing household does not change its trial', async () => {
    const ana = await register()
    const bea = await register({ signupSource: 'cr-prueba' })
    const anaHome = await primaryHousehold(ana.id)
    // Ana created it yesterday (with her own membership); Bea joins it today and makes it her primary one.
    const yesterday = new Date(Date.now() - 86_400_000)
    await db.update(households).set({ createdAt: yesterday }).where(eq(households.id, anaHome))
    await db.update(householdMembers).set({ joinedAt: yesterday }).where(eq(householdMembers.householdId, anaHome))
    await db.insert(householdMembers).values({ householdId: anaHome, userId: bea.id, role: 'member' })
    await db.update(users).set({ primaryHouseholdId: anaHome }).where(eq(users.id, bea.id))
    expect((await trial(bea.token)).trialDays).toBe(14)
    expect((await trial(ana.token)).trialDays).toBe(14)
    // Ana leaves and Bea inherits it (what deleting Ana's account does): still 14.
    await db.update(households).set({ ownerId: bea.id }).where(eq(households.id, anaHome))
    await db
      .update(householdMembers)
      .set({ role: 'owner' })
      .where(and(eq(householdMembers.householdId, anaHome), eq(householdMembers.userId, bea.id)))
    expect((await trial(bea.token)).trialDays).toBe(14)
  })
})
