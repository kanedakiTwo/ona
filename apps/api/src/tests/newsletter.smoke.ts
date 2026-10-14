/**
 * Smoke test for the newsletter (PRO-94, specs/newsletter.md) against a
 * running API + its Postgres: the newsletter-only opt-out over HTTP (the
 * place on the list stays) and the real SQL of the send claims (unique
 * issue + recipient, release, candidates).
 *
 *   API_URL=http://localhost:8790 DATABASE_URL=… SMOKE_USER_TOKEN=x \
 *     pnpm --filter @ona/api exec vitest run src/tests/newsletter.smoke.ts
 *
 * Skips when the API isn't reachable.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { newsletterSends } from '../db/schema.js'
import { createDbNewsletterRepo, recipientHash, selectNewsletterRecipients } from '../services/newsletter.js'

const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const email = `newsletter_${id}@test.local`
const ISSUE = `smoke-${id}`

function signup(extra: Record<string, unknown> = {}) {
  return {
    email,
    firstName: 'Smoke',
    householdSize: '2',
    plannerRole: 'yo',
    currentMethod: 'improviso',
    platform: 'ios',
    supermarket: null,
    wantsWhatsapp: false,
    newsletterOptIn: true,
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

async function call(method: string, path: string, payload?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

afterAll(async () => {
  if (reachable) await db.delete(newsletterSends).where(eq(newsletterSends.issueId, ISSUE))
})

describe.skipIf(!reachable)('newsletter (real API + DB)', () => {
  let leaveToken = ''
  let code = ''

  it('a waitlist signup with the box ticked is a candidate', async () => {
    const r = await call('POST', '/waitlist', signup())
    expect(r.status).toBe(200)
    leaveToken = r.body.unsubscribeToken
    code = r.body.code
    expect(leaveToken).toBeTruthy()
    const repo = createDbNewsletterRepo()
    const picked = selectNewsletterRecipients(await repo.candidates(), new Set())
    expect(picked.some((p) => p.email === email)).toBe(true)
  })

  it('claims are unique per issue + recipient; release lets a re-run claim again', async () => {
    const repo = createDbNewsletterRepo()
    const me = selectNewsletterRecipients(await repo.candidates(), new Set()).filter((p) => p.email === email)
    expect((await repo.claim(ISSUE, me)).has(recipientHash(email))).toBe(true)
    expect((await repo.claim(ISSUE, me)).size).toBe(0)
    expect((await repo.claimedHashes(ISSUE)).has(recipientHash(email))).toBe(true)
    await repo.release(ISSUE, [recipientHash(email)])
    expect((await repo.claim(ISSUE, me)).size).toBe(1)
    await repo.markSent(ISSUE, [{ hash: recipientHash(email), providerId: 'smoke' }])
    await repo.release(ISSUE, [recipientHash(email)]) // a sent row is never released
    expect((await repo.claimedHashes(ISSUE)).size).toBe(1)
  })

  it('POST /newsletter/unsubscribe turns off only the newsletter; the place on the list stays', async () => {
    const r = await call('POST', '/newsletter/unsubscribe', { token: `w.${leaveToken}` })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, alreadyUnsubscribed: false })
    expect((await call('POST', '/newsletter/unsubscribe', { token: `w.${leaveToken}` })).body.alreadyUnsubscribed).toBe(true)
    expect((await call('GET', `/waitlist/${code}`)).status).toBe(200)
    const repo = createDbNewsletterRepo()
    expect((await repo.candidates()).some((c) => c.email === email)).toBe(false)
    expect((await call('POST', '/newsletter/unsubscribe', { token: 'w.nonexistent-token-123456' })).status).toBe(404)
  })
})
