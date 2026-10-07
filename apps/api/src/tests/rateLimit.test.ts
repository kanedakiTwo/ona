/**
 * Pure-logic tests for the fixed-window rate limiter that guards the auth
 * endpoints. The Express wiring is thin; the load-bearing piece is the
 * counting + window-reset logic, so we test it directly with an injectable
 * clock (no timers, no server). A bug here either lets brute-force through or
 * locks out legitimate users.
 */
import type { NextFunction, Request, Response } from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FixedWindowCounter, isRateLimitDisabled, rateLimit } from '../middleware/rateLimit.js'

describe('FixedWindowCounter', () => {
  it('allows up to `max` hits within the window, then blocks', () => {
    const c = new FixedWindowCounter(3, 1000)
    expect(c.hit('ip', 0).allowed).toBe(true) // 1
    expect(c.hit('ip', 100).allowed).toBe(true) // 2
    expect(c.hit('ip', 200).allowed).toBe(true) // 3
    const fourth = c.hit('ip', 300)
    expect(fourth.allowed).toBe(false) // 4 → over
    expect(fourth.remaining).toBe(0)
  })

  it('reports remaining hits accurately', () => {
    const c = new FixedWindowCounter(2, 1000)
    expect(c.hit('ip', 0).remaining).toBe(1)
    expect(c.hit('ip', 1).remaining).toBe(0)
  })

  it('resets once the window elapses', () => {
    const c = new FixedWindowCounter(2, 1000)
    c.hit('ip', 0)
    c.hit('ip', 1)
    expect(c.hit('ip', 2).allowed).toBe(false) // blocked inside window
    // At/after resetAt (0 + 1000) the bucket starts fresh.
    expect(c.hit('ip', 1000).allowed).toBe(true)
    expect(c.hit('ip', 1001).allowed).toBe(true)
  })

  it('keys are independent — one IP hitting the cap does not block another', () => {
    const c = new FixedWindowCounter(1, 1000)
    expect(c.hit('a', 0).allowed).toBe(true)
    expect(c.hit('a', 1).allowed).toBe(false)
    expect(c.hit('b', 1).allowed).toBe(true) // different key, own budget
  })

  it('prune() drops only elapsed buckets', () => {
    const c = new FixedWindowCounter(5, 1000)
    c.hit('old', 0)
    c.hit('fresh', 900)
    c.prune(1000) // 'old' window (0+1000) is up; 'fresh' (900+1000) is not
    expect(c.size()).toBe(1)
  })
})

/** Minimal Express doubles: enough surface for the middleware under test. */
function fakeReq(ip = '127.0.0.1'): Request {
  return { ip } as unknown as Request
}
function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      res.headers[name] = value
      return res
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.body = body
      return res
    },
  }
  return res
}
/** Fire `n` requests through `mw`; return how many reached `next()` and the last status. */
function fire(mw: ReturnType<typeof rateLimit>, n: number) {
  let passed = 0
  let lastStatus = 200
  for (let i = 0; i < n; i++) {
    const res = fakeRes()
    mw(fakeReq(), res as unknown as Response, (() => { passed++ }) as NextFunction)
    lastStatus = res.statusCode
  }
  return { passed, lastStatus }
}

describe('isRateLimitDisabled', () => {
  it('is off unless RATE_LIMIT_DISABLED is explicitly set', () => {
    expect(isRateLimitDisabled({})).toBe(false)
    expect(isRateLimitDisabled({ RATE_LIMIT_DISABLED: '' })).toBe(false)
    expect(isRateLimitDisabled({ RATE_LIMIT_DISABLED: 'false' })).toBe(false)
    expect(isRateLimitDisabled({ RATE_LIMIT_DISABLED: 'yes-please' })).toBe(false)
  })

  it('honours true / 1 outside production (CI, e2e, dev)', () => {
    expect(isRateLimitDisabled({ RATE_LIMIT_DISABLED: 'true' })).toBe(true)
    expect(isRateLimitDisabled({ RATE_LIMIT_DISABLED: '1', NODE_ENV: 'test' })).toBe(true)
    expect(isRateLimitDisabled({ RATE_LIMIT_DISABLED: 'TRUE', NODE_ENV: 'development' })).toBe(true)
  })

  it('is ignored on a deployed runtime — prod limits can never be switched off by env', () => {
    expect(isRateLimitDisabled({ RATE_LIMIT_DISABLED: 'true', NODE_ENV: 'production' })).toBe(false)
    expect(isRateLimitDisabled({ RATE_LIMIT_DISABLED: '1', NODE_ENV: 'production' })).toBe(false)
    // Railway runs the API without NODE_ENV — the Railway env marker alone
    // must keep the limiter on.
    expect(isRateLimitDisabled({ RATE_LIMIT_DISABLED: 'true', RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(false)
  })
})

describe('rateLimit middleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns 429 once the cap is exceeded (default behaviour)', () => {
    const mw = rateLimit({ max: 2, windowMs: 60_000, disabled: false })
    const { passed, lastStatus } = fire(mw, 3)
    expect(passed).toBe(2)
    expect(lastStatus).toBe(429)
  })

  it('lets every request through when disabled', () => {
    const mw = rateLimit({ max: 2, windowMs: 60_000, disabled: true })
    const { passed, lastStatus } = fire(mw, 25)
    expect(passed).toBe(25)
    expect(lastStatus).toBe(200)
  })

  it('reads RATE_LIMIT_DISABLED from the environment when not passed explicitly', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true')
    expect(fire(rateLimit({ max: 1, windowMs: 60_000 }), 5).passed).toBe(5)
  })

  it('still enforces the cap in production even with RATE_LIMIT_DISABLED=true', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true')
    const { passed, lastStatus } = fire(rateLimit({ max: 1, windowMs: 60_000 }), 3)
    expect(passed).toBe(1)
    expect(lastStatus).toBe(429)
  })

  it('still enforces the cap on Railway (no NODE_ENV) with RATE_LIMIT_DISABLED=true', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('NODE_ENV', '')
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production')
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true')
    const { passed, lastStatus } = fire(rateLimit({ max: 1, windowMs: 60_000 }), 3)
    expect(passed).toBe(1)
    expect(lastStatus).toBe(429)
  })
})
