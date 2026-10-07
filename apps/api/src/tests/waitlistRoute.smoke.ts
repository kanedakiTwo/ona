/**
 * Smoke test for the pre-launch waitlist (specs/waitlist.md) against a
 * running API + Postgres — the real SQL behind the route tests' in-memory
 * repo: unique email (idempotent signup), referral attribution and count,
 * the anonymising opt-out, and the admin report / metrics block when
 * METRICS_READ_TOKEN is available (set in CI's smoke job).
 *
 *   API_URL=http://localhost:8790 pnpm --filter @ona/api exec vitest run src/tests/waitlistRoute.smoke.ts
 *
 * Needs RATE_LIMIT_DISABLED on that API when run repeatedly (the signup
 * limit is 20/hour/IP). Skips when the API isn't reachable.
 */
import { describe, expect, it } from 'vitest'
import { API_URL, reachable } from './smokeEnv.js'

const METRICS_TOKEN = process.env.METRICS_READ_TOKEN ?? ''
const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const ownerEmail = `waitlist_${id}@test.local`

function body(email: string, extra: Record<string, unknown> = {}) {
  return {
    email,
    firstName: 'Smoke',
    householdSize: '3-4',
    plannerRole: 'compartido',
    currentMethod: 'lista',
    platform: 'android',
    supermarket: null,
    wantsWhatsapp: true,
    newsletterOptIn: false,
    consent: true,
    website: '',
    source: 'smoke',
    referredByCode: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    ...extra,
  }
}

async function call(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

describe.skipIf(!reachable)('waitlist route smoke', () => {
  let owner: { code: string; unsubscribeToken: string }

  it('signs up, and a repeat with the same email (any case) returns the same link without the opt-out token', async () => {
    const first = await call('POST', '/waitlist', body(ownerEmail, { newsletterOptIn: true }))
    expect(first.status).toBe(200)
    expect(first.body.code).toMatch(/^[0-9a-z]{8}$/)
    expect(first.body.unsubscribeToken).toBeTruthy()
    owner = first.body

    const again = await call('POST', '/waitlist', body(ownerEmail.toUpperCase(), { householdSize: '1' }))
    expect(again.status).toBe(200)
    expect(again.body.code).toBe(owner.code)
    expect(again.body.unsubscribeToken).toBeUndefined()
  })

  it('attributes a referral and counts it on the owner page', async () => {
    const mate = await call('POST', '/waitlist', body(`waitlist_${id}_mate@test.local`, { referredByCode: owner.code }))
    expect(mate.status).toBe(200)
    const status = await call('GET', `/waitlist/${owner.code}`)
    expect(status.status).toBe(200)
    expect(status.body.referredCount).toBe(1)
    expect(JSON.stringify(status.body)).not.toContain('@')
  })

  it('admin report (read token): aggregates and ids, never an email', async () => {
    if (!METRICS_TOKEN) return
    const r = await call('GET', '/admin/waitlist?batchSize=500', undefined, { 'x-metrics-token': METRICS_TOKEN })
    expect(r.status).toBe(200)
    expect(r.body.totals.entries).toBeGreaterThanOrEqual(2)
    expect(r.body.referrals.topReferrers.some((t: any) => t.code === owner.code)).toBe(true)
    expect(Array.isArray(r.body.suggestedNextBatch.ids)).toBe(true)
    expect(JSON.stringify(r.body)).not.toContain(ownerEmail)

    const m = await call('GET', '/admin/metrics?weeks=1', undefined, { 'x-metrics-token': METRICS_TOKEN })
    expect(m.status).toBe(200)
    expect(m.body.waitlist.entries).toBeGreaterThanOrEqual(2)
    expect(m.body.waitlist.newsletterOptIns).toBeGreaterThanOrEqual(1)
  })

  it('unsubscribing anonymises the entry: the owner page 404s, a second click says "already"', async () => {
    const out = await call('POST', '/waitlist/unsubscribe', { token: owner.unsubscribeToken })
    expect(out.status).toBe(200)
    expect(out.body).toEqual({ ok: true, alreadyUnsubscribed: false })
    expect((await call('GET', `/waitlist/${owner.code}`)).status).toBe(404)
    const again = await call('POST', '/waitlist/unsubscribe', { token: owner.unsubscribeToken })
    expect(again.body.alreadyUnsubscribed).toBe(true)
    // The email is gone, so it can sign up again as a fresh entry.
    const back = await call('POST', '/waitlist', body(ownerEmail))
    expect(back.status).toBe(200)
    expect(back.body.code).not.toBe(owner.code)
    expect(back.body.unsubscribeToken).toBeTruthy()
    await call('POST', '/waitlist/unsubscribe', { token: back.body.unsubscribeToken })
  })
})
