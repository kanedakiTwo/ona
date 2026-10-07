/**
 * JWT secret hygiene. A short/missing secret on a deployed API lets anyone
 * mint a token for any user, so the boot must fail. And a token the API no
 * longer accepts (e.g. after rotating the secret) must come back as
 * INVALID_TOKEN so the web client logs out instead of erroring forever.
 */
import { describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import type { Response } from 'express'
import { MIN_JWT_SECRET_LENGTH, isDeployedRuntime, resolveJwtSecret } from '../config/jwtSecret.js'

vi.mock('../db/connection.js', () => ({ db: {} }))

const strong = 'x'.repeat(MIN_JWT_SECRET_LENGTH)

describe('resolveJwtSecret', () => {
  it('keeps the dev fallback locally', () => {
    expect(resolveJwtSecret({})).toBe('ona-dev-secret')
    expect(resolveJwtSecret({ JWT_SECRET: 'short' })).toBe('short')
  })

  it('treats Railway as deployed even without NODE_ENV', () => {
    expect(isDeployedRuntime({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(true)
    expect(isDeployedRuntime({ NODE_ENV: 'production' })).toBe(true)
    expect(isDeployedRuntime({ NODE_ENV: 'test' })).toBe(false)
  })

  it('refuses a missing or short secret on a deployed API', () => {
    expect(() => resolveJwtSecret({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toThrow(/JWT_SECRET/)
    expect(() =>
      resolveJwtSecret({ RAILWAY_ENVIRONMENT_NAME: 'production', JWT_SECRET: 'x'.repeat(21) }),
    ).toThrow(/at least 32/)
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: '' })).toThrow()
  })

  it('accepts a long enough secret on a deployed API', () => {
    expect(resolveJwtSecret({ RAILWAY_ENVIRONMENT_NAME: 'production', JWT_SECRET: strong })).toBe(strong)
  })
})

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

describe('authMiddleware with a token it no longer accepts', () => {
  it('answers 401 INVALID_TOKEN for a token signed with another secret', async () => {
    const { authMiddleware } = await import('../middleware/auth.js')
    const token = jwt.sign({ userId: 'u1' }, 'the-old-rotated-secret')
    const res = fakeRes()
    const next = vi.fn()
    await authMiddleware({ headers: { authorization: `Bearer ${token}` } } as any, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe('INVALID_TOKEN')
  })

  it('answers 401 INVALID_TOKEN for garbage', async () => {
    const { authMiddleware } = await import('../middleware/auth.js')
    const res = fakeRes()
    await authMiddleware({ headers: { authorization: 'Bearer not-a-jwt' } } as any, res, vi.fn())
    expect(res.body.code).toBe('INVALID_TOKEN')
  })
})
