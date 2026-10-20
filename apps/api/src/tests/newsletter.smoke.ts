/**
 * Smoke test for the newsletter (PRO-94, specs/newsletter.md) against a
 * running API + its Postgres: the newsletter-only opt-out over HTTP (the
 * place on the list stays) and the real SQL of the send claims (unique
 * issue + recipient, release, candidates). PRO-132: leaving the list or
 * deleting the account deletes the email's send traces; the
 * newsletter-only opt-out keeps them.
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
import { newsletterSends, newsletterUnsubscribes } from '../db/schema.js'
import { createDbNewsletterRepo, recipientHash, selectNewsletterRecipients } from '../services/newsletter.js'
import { createDbNewsletterStatsRepo } from '../services/newsletterStats.js'

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
  if (!reachable) return
  await db.delete(newsletterSends).where(eq(newsletterSends.issueId, ISSUE))
  await db.delete(newsletterUnsubscribes).where(eq(newsletterUnsubscribes.issueId, ISSUE))
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
    // PRO-130: the entry's own invite code travels with it, for the footer link.
    expect(code).toBeTruthy()
    expect(picked.find((p) => p.email === email)?.referralCode).toBe(code)
  })

  it('claims are unique per issue + recipient; release lets a re-run claim again', async () => {
    const repo = createDbNewsletterRepo()
    const me = selectNewsletterRecipients(await repo.candidates(), new Set()).filter((p) => p.email === email)
    expect((await repo.claim(ISSUE, me)).has(recipientHash(email))).toBe(true)
    // A claim still pending is not a send: an opt-out can't count under it yet.
    const stats = createDbNewsletterStatsRepo()
    expect(await stats.wasSentTo(ISSUE, recipientHash(email))).toBe(false)
    expect((await repo.claim(ISSUE, me)).size).toBe(0)
    expect((await repo.claimedHashes(ISSUE)).has(recipientHash(email))).toBe(true)
    await repo.release(ISSUE, [recipientHash(email)])
    expect((await repo.claim(ISSUE, me)).size).toBe(1)
    await repo.markSent(ISSUE, [{ hash: recipientHash(email), providerId: 'smoke' }])
    await repo.release(ISSUE, [recipientHash(email)]) // a sent row is never released
    expect((await repo.claimedHashes(ISSUE)).size).toBe(1)
    // An opt-out counts under an issue only if that issue was sent to that address.
    expect(await stats.wasSentTo(ISSUE, recipientHash(email))).toBe(true)
    expect(await stats.wasSentTo(ISSUE, recipientHash(`otra_${id}@test.local`))).toBe(false)
    expect(await stats.wasSentTo(`no-enviado-${id}`, recipientHash(email))).toBe(false)
  })

  it('a user who registers with the box ticked is a recipient; PUT /newsletter/me false takes them out (PRO-95)', async () => {
    const reg = await call('POST', '/register', {
      username: `nl_${id}`,
      email: `nl_user_${id}@test.local`,
      password: 'smokepass123',
      ageConfirmed: true,
      newsletterOptIn: true,
    })
    expect(reg.status).toBe(201)
    expect(reg.body.user.newsletterOptIn).toBe(true)
    expect(reg.body.user.newsletterConsentVersion).toBeTruthy()
    const repo = createDbNewsletterRepo()
    const has = async () => selectNewsletterRecipients(await repo.candidates(), new Set()).some((p) => p.email === `nl_user_${id}@test.local`)
    expect(await has()).toBe(true)
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${reg.body.token}` }
    const me = await fetch(`${API_URL}/newsletter/me`, { headers })
    expect(await me.json()).toEqual({ optIn: true })
    const off = await fetch(`${API_URL}/newsletter/me`, { method: 'PUT', headers, body: JSON.stringify({ optIn: false }) })
    expect(await off.json()).toEqual({ optIn: false })
    expect(await has()).toBe(false)
  })

  it('POST /newsletter/unsubscribe turns off only the newsletter; the place on the list stays', async () => {
    // Someone who signed up after the issue went out: the opt-out happens, but not under that issue.
    const late = await call('POST', '/waitlist', signup({ email: `newsletter_late_${id}@test.local` }))
    expect(late.status).toBe(200)
    const lateOff = await call('POST', '/newsletter/unsubscribe', { token: `w.${late.body.unsubscribeToken}`, issueId: ISSUE })
    expect(lateOff.body).toEqual({ ok: true, alreadyUnsubscribed: false })
    expect(await unsubscribesFor(ISSUE)).toBe(0)
    // The address the issue was sent to counts under it.
    const r = await call('POST', '/newsletter/unsubscribe', { token: `w.${leaveToken}`, issueId: ISSUE })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, alreadyUnsubscribed: false })
    expect(await unsubscribesFor(ISSUE)).toBe(1)
    expect((await call('POST', '/newsletter/unsubscribe', { token: `w.${leaveToken}` })).body.alreadyUnsubscribed).toBe(true)
    expect((await call('GET', `/waitlist/${code}`)).status).toBe(200)
    const repo = createDbNewsletterRepo()
    expect((await repo.candidates()).some((c) => c.email === email)).toBe(false)
    expect((await call('POST', '/newsletter/unsubscribe', { token: 'w.nonexistent-token-123456' })).status).toBe(404)
    // PRO-132: the newsletter-only opt-out keeps the send traces (no re-send of the same issue).
    expect(await sendsFor(email)).toBe(1)
  })

  it('leaving the list (/lista/baja) deletes the send traces of that email (PRO-132)', async () => {
    const r = await call('POST', '/waitlist/unsubscribe', { token: leaveToken })
    expect(r.status).toBe(200)
    expect(await sendsFor(email)).toBe(0)
  })

  it('deleting the account deletes the send traces of its email (PRO-132)', async () => {
    const userEmail = `nl_del_${id}@test.local`
    const reg = await call('POST', '/register', { username: `nl_del_${id}`, email: userEmail, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    await db.insert(newsletterSends).values({ issueId: ISSUE, recipientHash: recipientHash(userEmail), source: 'user', status: 'sent' })
    expect(await sendsFor(userEmail)).toBe(1)
    const del = await fetch(`${API_URL}/user/${reg.body.user.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reg.body.token}` },
      body: JSON.stringify({ password: 'smokepass123' }),
    })
    expect(del.status).toBe(200)
    expect(await sendsFor(userEmail)).toBe(0)
  })
})

async function unsubscribesFor(issueId: string): Promise<number> {
  const rows = await db.select({ id: newsletterUnsubscribes.id }).from(newsletterUnsubscribes).where(eq(newsletterUnsubscribes.issueId, issueId))
  return rows.length
}

async function sendsFor(address: string): Promise<number> {
  const rows = await db.select({ h: newsletterSends.recipientHash }).from(newsletterSends).where(eq(newsletterSends.recipientHash, recipientHash(address)))
  return rows.length
}
