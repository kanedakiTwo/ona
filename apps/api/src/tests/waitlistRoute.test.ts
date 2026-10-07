/**
 * Route tests for the pre-launch waitlist (specs/waitlist.md), on a real
 * Express app bound to an ephemeral port. The repo is in-memory (same
 * semantics as Postgres: unique email/code/token, anonymising opt-out); the
 * rate limiter, metricsAuth and the zod schema are the real thing.
 *
 *   POST /waitlist               idempotent on email, honeypot, rate limit, referral attribution
 *   GET  /waitlist/:code         referral count only, 404 for unknown/left
 *   POST /waitlist/unsubscribe   anonymises, turns the newsletter off, idempotent
 *   GET  /admin/waitlist         401 without credentials, 200 with x-metrics-token
 *   POST /admin/waitlist/invite  admin JWT only (the read token can't invite)
 */
import express from 'express'
import type { RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EMPTY_WAITLIST_FORM, buildWaitlistPayload, readWaitlistAttribution } from '@ona/shared'
import { env } from '../config/env.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { adminWaitlistRouter, createAdminWaitlistRouter, createWaitlistRouter } from '../routes/waitlist.js'
import { toWaitlistSummary } from '../services/waitlist.js'
import { createMemoryWaitlistRepo } from './fixtures/memoryWaitlistRepo.js'

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

const pass: RequestHandler = (_req, _res, next) => next()

function publicApp(overrides: Parameters<typeof createWaitlistRouter>[0] = {}) {
  const repo = createMemoryWaitlistRepo()
  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())
  app.use(
    createWaitlistRouter({
      repo,
      publicUrl: () => 'https://mimoia.com',
      signupLimiter: pass,
      readLimiter: pass,
      unsubscribeLimiter: pass,
      ...overrides,
    }),
  )
  return { app, repo }
}

/** Exactly what the landing form sends. */
function formBody(over: Partial<typeof EMPTY_WAITLIST_FORM> = {}, search = '') {
  return buildWaitlistPayload(
    {
      ...EMPTY_WAITLIST_FORM,
      email: 'lucia@example.com',
      householdSize: '2',
      plannerRole: 'yo',
      currentMethod: 'improviso',
      platform: 'android',
      consent: true,
      ...over,
    },
    readWaitlistAttribution(new URLSearchParams(search)),
  )
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /waitlist', () => {
  let base: string
  let repo: ReturnType<typeof createMemoryWaitlistRepo>

  beforeAll(async () => {
    const built = publicApp()
    repo = built.repo
    base = await serve(built.app)
  })

  it('signs up and answers with the referral link + the one-time opt-out token', async () => {
    const res = await post(base, '/waitlist', formBody({}, '?ref=menu&utm_source=instagram'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.referralUrl).toBe(`https://mimoia.com/?invita=${body.code}`)
    expect(body.referredCount).toBe(0)
    expect(typeof body.unsubscribeToken).toBe('string')
    expect(repo.rows[0]).toMatchObject({ source: 'menu', utmSource: 'instagram', newsletterOptIn: false })
  })

  it('is idempotent on email: same success, same link, no opt-out token, nothing written', async () => {
    const first = repo.rows[0]
    const res = await post(base, '/waitlist', formBody({ email: ' LUCIA@Example.com ', householdSize: '5+' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ code: first.referralCode, referralUrl: `https://mimoia.com/?invita=${first.referralCode}`, referredCount: 0 })
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0].householdSize).toBe('2')
  })

  it('attributes ?invita=<code> to the referrer, whose count goes up', async () => {
    const code = repo.rows[0].referralCode
    const res = await post(base, '/waitlist', formBody({ email: 'pareja@example.com' }, `?invita=${code}`))
    expect(res.status).toBe(200)
    expect(repo.rows[1]).toMatchObject({ referredByCode: code, source: 'invita' })
    const status = await fetch(`${base}/waitlist/${code}`)
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ code, referralUrl: `https://mimoia.com/?invita=${code}`, referredCount: 1 })
  })

  it('ignores an unknown ?invita code instead of failing the signup', async () => {
    const res = await post(base, '/waitlist', formBody({ email: 'otra@example.com' }, '?invita=zzzzzzzz'))
    expect(res.status).toBe(200)
    expect(repo.rows.at(-1)!.referredByCode).toBeNull()
  })

  it('stores the separate newsletter consent only when ticked', async () => {
    await post(base, '/waitlist', formBody({ email: 'boletin@example.com', newsletterOptIn: true }))
    const row = repo.rows.at(-1)!
    expect(row.newsletterOptIn).toBe(true)
    expect(row.newsletterConsentAt).toBeInstanceOf(Date)
    expect(row.newsletterConsentVersion).toBeTruthy()
  })

  it('400 on bad email or missing consent (with the field), 400 on a filled honeypot (no hint)', async () => {
    const before = repo.rows.length
    const bad = await post(base, '/waitlist', formBody({ email: 'no-es-un-email' }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ code: 'INVALID_WAITLIST_SIGNUP', field: 'email' })
    const noConsent = await post(base, '/waitlist', formBody({ email: 'x@example.com', consent: false }))
    expect((await noConsent.json()).field).toBe('consent')
    const bot = await post(base, '/waitlist', formBody({ email: 'bot@example.com', website: 'http://spam.example' }))
    expect(bot.status).toBe(400)
    const botBody = await bot.json()
    expect(botBody.field).toBeUndefined()
    expect(botBody.error).not.toMatch(/website|honeypot/i)
    expect(repo.rows).toHaveLength(before)
  })

  it('per-IP rate limit: 429 with Retry-After once over the limit; another IP is unaffected', async () => {
    const { app } = publicApp({ signupLimiter: rateLimit({ max: 2, windowMs: 60_000, disabled: false }) })
    const b = await serve(app)
    const ip = { 'x-forwarded-for': '203.0.113.7' }
    const statuses: number[] = []
    for (let i = 0; i < 3; i++) statuses.push((await post(b, '/waitlist', formBody({ email: `rl${i}@example.com` }), ip)).status)
    expect(statuses).toEqual([200, 200, 429])
    const limited = await post(b, '/waitlist', formBody({ email: 'rl9@example.com' }), ip)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect((await limited.json()).code).toBe('RATE_LIMITED')
    expect((await post(b, '/waitlist', formBody({ email: 'rl-other@example.com' }), { 'x-forwarded-for': '203.0.113.8' })).status).toBe(200)
  })
})

describe('GET /waitlist/:code', () => {
  it('404 for malformed or unknown codes', async () => {
    const { app } = publicApp()
    const b = await serve(app)
    expect((await fetch(`${b}/waitlist/nope`)).status).toBe(404)
    expect((await fetch(`${b}/waitlist/zzzzzzzz`)).status).toBe(404)
  })
})

describe('POST /waitlist/unsubscribe', () => {
  it('anonymises the entry, turns the newsletter off, is idempotent, and the owner page goes away', async () => {
    const { app, repo } = publicApp()
    const b = await serve(app)
    const signup = await (await post(b, '/waitlist', formBody({ newsletterOptIn: true, firstName: 'Lucía', supermarket: 'el mercado' }))).json()

    const res = await post(b, '/waitlist/unsubscribe', { token: signup.unsubscribeToken })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, alreadyUnsubscribed: false })
    expect(repo.rows[0]).toMatchObject({ status: 'unsubscribed', email: null, firstName: null, supermarket: null, newsletterOptIn: false })

    const again = await post(b, '/waitlist/unsubscribe', { token: signup.unsubscribeToken })
    expect(await again.json()).toEqual({ ok: true, alreadyUnsubscribed: true })
    expect((await fetch(`${b}/waitlist/${signup.code}`)).status).toBe(404)

    // The same email can sign up again later (a fresh entry, fresh consent).
    expect((await post(b, '/waitlist', formBody())).status).toBe(200)
    expect(repo.rows).toHaveLength(2)
  })

  it('404 for an unknown or malformed token', async () => {
    const { app } = publicApp()
    const b = await serve(app)
    expect((await post(b, '/waitlist/unsubscribe', { token: 'x'.repeat(32) })).status).toBe(404)
    expect((await post(b, '/waitlist/unsubscribe', { token: 'short' })).status).toBe(404)
    expect((await post(b, '/waitlist/unsubscribe', {})).status).toBe(404)
  })
})

describe('GET /admin/waitlist', () => {
  const previousToken = env.METRICS_READ_TOKEN
  const load = vi.fn(async (q: any) => ({ totals: { entries: 0 }, query: q }))
  let base: string
  let defaultBase: string

  beforeAll(async () => {
    env.METRICS_READ_TOKEN = 'waitlist-test-token'
    const app = express()
    app.use(express.json())
    app.use(createAdminWaitlistRouter({ load: load as any })) // real metricsAuth
    base = await serve(app)
    const defaultApp = express()
    defaultApp.use(express.json())
    defaultApp.use(adminWaitlistRouter)
    defaultBase = await serve(defaultApp)
  })
  afterAll(() => {
    env.METRICS_READ_TOKEN = previousToken
  })

  it('401 without credentials (the mounted router, no DB touched)', async () => {
    expect((await fetch(`${defaultBase}/admin/waitlist`)).status).toBe(401)
  })

  it('401 with a wrong token', async () => {
    const res = await fetch(`${base}/admin/waitlist`, { headers: { 'x-metrics-token': 'nope' } })
    expect(res.status).toBe(401)
    expect(load).not.toHaveBeenCalled()
  })

  it('200 with the read token; params are clamped', async () => {
    const res = await fetch(`${base}/admin/waitlist?days=9999&batchSize=0`, { headers: { 'x-metrics-token': 'waitlist-test-token' } })
    expect(res.status).toBe(200)
    expect(load).toHaveBeenLastCalledWith({ days: 365, batchSize: 1 })
    await fetch(`${base}/admin/waitlist`, { headers: { 'x-metrics-token': 'waitlist-test-token' } })
    expect(load).toHaveBeenLastCalledWith({ days: 30, batchSize: 20 })
  })
})

describe('POST /admin/waitlist/invite', () => {
  const ID = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f70'

  it('needs an admin JWT: 401 anonymous, and the metrics read token does not open it', async () => {
    const previousToken = env.METRICS_READ_TOKEN
    env.METRICS_READ_TOKEN = 'waitlist-test-token'
    const app = express()
    app.use(express.json())
    app.use(adminWaitlistRouter)
    const b = await serve(app)
    expect((await post(b, '/admin/waitlist/invite', { ids: [ID] })).status).toBe(401)
    expect((await post(b, '/admin/waitlist/invite', { ids: [ID] }, { 'x-metrics-token': 'waitlist-test-token' })).status).toBe(401)
    env.METRICS_READ_TOKEN = previousToken
  })

  it('as an admin: 400 on a bad body, 200 passes ids + batch + admin id through', async () => {
    const asAdmin: RequestHandler = (req, _res, next) => {
      ;(req as any).userId = '11111111-1111-4111-8111-111111111111'
      next()
    }
    const invite = vi.fn(async () => ({ batch: 3, skipped: 0, invited: [] }))
    const app = express()
    app.use(express.json())
    app.use(createAdminWaitlistRouter({ adminAuth: [asAdmin], invite: invite as any, publicUrl: () => 'https://mimoia.com' }))
    const b = await serve(app)
    expect((await post(b, '/admin/waitlist/invite', { ids: ['not-a-uuid'] })).status).toBe(400)
    expect((await post(b, '/admin/waitlist/invite', { ids: [] })).status).toBe(400)
    const ok = await post(b, '/admin/waitlist/invite', { ids: [ID], batch: 3 })
    expect(ok.status).toBe(200)
    expect(invite).toHaveBeenLastCalledWith([ID], 3, '11111111-1111-4111-8111-111111111111', { publicUrl: 'https://mimoia.com' })
  })
})

describe('toWaitlistSummary (the GET /admin/metrics block)', () => {
  it('maps the SQL row, tolerating string counts and missing values', () => {
    expect(
      toWaitlistSummary({ entries: '12', waiting: 9, invited: 2, joined: 1, unsubscribed: 0, last7_days: 4, referred: 3, newsletter: '5' }),
    ).toEqual({ entries: 12, waiting: 9, invited: 2, joined: 1, unsubscribed: 0, last7Days: 4, referredSignups: 3, newsletterOptIns: 5 })
    expect(toWaitlistSummary({}).entries).toBe(0)
  })
})
