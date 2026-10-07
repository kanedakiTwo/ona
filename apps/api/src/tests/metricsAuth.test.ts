/**
 * Auth guard for GET /admin/metrics: an admin JWT OR `x-metrics-token` equal
 * to METRICS_READ_TOKEN (constant-time compare). The token path is disabled
 * when the env var is unset. A bug here either leaks business metrics or
 * locks the Dirección agent out.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { createMetricsAuth, tokenMatches } from '../middleware/metricsAuth.js'

function fakeReq(headers: Record<string, string> = {}): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => lower[name.toLowerCase()] } as unknown as Request
}

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  return res as Response & { statusCode: number; body: any }
}

/** Stand-in for authMiddleware + requireAdmin: rejects like a request without a Bearer token. */
const rejectingAdminAuth = vi.fn((_req: Request, res: Response) => {
  res.status(401).json({ error: 'No token provided' })
})

describe('tokenMatches', () => {
  it('is true only for the exact token (length differences included)', () => {
    expect(tokenMatches('s3cret-token', 's3cret-token')).toBe(true)
    expect(tokenMatches('s3cret-tokeN', 's3cret-token')).toBe(false)
    expect(tokenMatches('s3cret', 's3cret-token')).toBe(false)
    expect(tokenMatches('', 's3cret-token')).toBe(false)
  })
})

describe('createMetricsAuth', () => {
  it('accepts a valid x-metrics-token without touching JWT auth', () => {
    const adminAuth = vi.fn()
    const guard = createMetricsAuth({ expectedToken: () => 'metrics-abc', adminAuth })
    const next = vi.fn()
    const res = fakeRes()
    guard(fakeReq({ 'x-metrics-token': 'metrics-abc' }), res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(adminAuth).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
  })

  it('rejects a wrong token with 401 (no fallback to JWT)', () => {
    const adminAuth = vi.fn()
    const guard = createMetricsAuth({ expectedToken: () => 'metrics-abc', adminAuth })
    const next = vi.fn()
    const res = fakeRes()
    guard(fakeReq({ 'x-metrics-token': 'metrics-abd' }), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(adminAuth).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe('METRICS_TOKEN_INVALID')
  })

  it('without the header, defers to admin JWT auth (which rejects anonymous callers)', () => {
    const guard = createMetricsAuth({ expectedToken: () => 'metrics-abc', adminAuth: rejectingAdminAuth })
    const next = vi.fn()
    const res = fakeRes()
    guard(fakeReq(), res, next)
    expect(rejectingAdminAuth).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it('without the header, an admin JWT passes through the admin path', () => {
    const adminAuth = vi.fn((_req, _res, next) => next())
    const guard = createMetricsAuth({ expectedToken: () => 'metrics-abc', adminAuth })
    const next = vi.fn()
    guard(fakeReq({ authorization: 'Bearer admin.jwt' }), fakeRes(), next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('token auth is disabled when METRICS_READ_TOKEN is unset — even an empty header is rejected', () => {
    const adminAuth = vi.fn()
    const guard = createMetricsAuth({ expectedToken: () => '', adminAuth })
    for (const provided of ['', 'anything']) {
      const next = vi.fn()
      const res = fakeRes()
      guard(fakeReq({ 'x-metrics-token': provided }), res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(401)
      expect(res.body.code).toBe('METRICS_TOKEN_DISABLED')
    }
    expect(adminAuth).not.toHaveBeenCalled()
  })
})
