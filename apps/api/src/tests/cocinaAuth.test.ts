import { describe, expect, it, vi } from 'vitest'
import { createCocinaAuth } from '../middleware/cocinaAuth.js'

function run(headers: Record<string, string>, expected = 'secreto') {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(c: number) {
      this.statusCode = c
      return this
    },
    json(b: unknown) {
      this.body = b
      return this
    },
  }
  const next = vi.fn()
  const adminAuth = vi.fn((_req, _res, n) => n())
  const req = { get: (h: string) => headers[h.toLowerCase()] } as any
  createCocinaAuth({ expectedToken: () => expected, adminAuth })(req, res as any, next)
  return { res, next, adminAuth }
}

describe('cocinaAuth', () => {
  it('no header → admin JWT path', () => {
    const { adminAuth, next } = run({})
    expect(adminAuth).toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })
  it('right token → next', () => expect(run({ 'x-cocina-token': 'secreto' }).next).toHaveBeenCalled())
  it('wrong token → 401, no JWT fallback', () => {
    const { res, next, adminAuth } = run({ 'x-cocina-token': 'otro' })
    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
    expect(adminAuth).not.toHaveBeenCalled()
  })
  it('token unset → 401 even with a header', () => expect(run({ 'x-cocina-token': '' }, '').res.statusCode).toBe(401))
})
