/**
 * Pure-logic tests for the in-house error tracker (specs/errors.md):
 * scrubbing (what never reaches the database), message normalisation and
 * fingerprinting (what groups together), user-agent families, and the write
 * throttle that keeps a broken client loop from flooding `app_errors`.
 *
 * A bug in `scrub` leaks personal data into a table the agents read; a bug in
 * `normalizeMessage` / `fingerprint` either splits one bug into hundreds of
 * groups or merges unrelated bugs into one.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  ErrorWriteThrottle,
  buildAppErrorRow,
  cleanPath,
  fingerprint,
  flushCoalescedErrors,
  normalizeMessage,
  normalizeRoutePath,
  recordAppError,
  resetAppErrorThrottlesForTests,
  scrub,
  serverRelease,
  setAppErrorSinkForTests,
  topStackFrame,
  userAgentFamily,
  type AppErrorRow,
} from '../services/appErrors.js'

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjM0In0.dGhpcy1pcy1hLXNpZ25hdHVyZQ'
const UUID = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f70'

describe('scrub', () => {
  it('removes email addresses', () => {
    expect(scrub('No se pudo invitar a miguel.martin+ona@aikit.io')).toBe('No se pudo invitar a <email>')
  })

  it('removes Bearer credentials and JWT-like tokens', () => {
    expect(scrub(`Authorization: Bearer ${JWT}`)).toBe('Authorization: Bearer <redacted>')
    expect(scrub(`token ${JWT} rechazado`)).toBe('token <jwt> rechazado')
  })

  it('removes query strings and fragments with values (tokens, codes, searches)', () => {
    expect(scrub('GET https://ona.app/reset?token=abc123&next=%2Fmenu falló')).toBe('GET https://ona.app/reset falló')
    expect(scrub('/recipes?search=pollo')).toBe('/recipes')
    expect(scrub('/auth/callback#access_token=xyz')).toBe('/auth/callback')
    // A bare question mark (Spanish questions) is not a query string.
    expect(scrub('¿Seguro?')).toBe('¿Seguro?')
  })

  it('removes phone numbers in the usual Spanish / WhatsApp shapes', () => {
    expect(scrub('Enviar a +34 600 111 222')).toBe('Enviar a <phone>')
    expect(scrub('wa_id 34600111222 sin vincular')).toBe('wa_id <phone> sin vincular')
    expect(scrub('llamar al 600-111-222')).toBe('llamar al <phone>')
  })

  it('removes IPv4 addresses', () => {
    expect(scrub('connect ECONNREFUSED 10.0.3.17:5432')).toBe('connect ECONNREFUSED <ip>:5432')
  })

  it('removes secret-looking tokens (invite hex tokens, mixed-case keys) but keeps UUIDs', () => {
    expect(scrub('/invites/0123456789abcdef0123456789abcdef')).toBe('/invites/<token>')
    expect(scrub('key sk-ant-api03-AbCdEf123456GhIjKl inválida')).toBe('key <token> inválida')
    expect(scrub(`/recipes/${UUID}`)).toBe(`/recipes/${UUID}`)
  })

  it('removes the bound values of a failed query (Drizzle "params:" line), keeping the SQL', () => {
    const msg = 'Failed query: insert into "households" ("name") values ($1)\nparams: Casa de Miguel Martín,Calle Mayor 3'
    expect(scrub(msg)).toBe('Failed query: insert into "households" ("name") values ($1)\nparams: <redacted>')
  })

  it('leaves ordinary stack frames intact (line:col, chunk hashes)', () => {
    const frame = 'at renderMeal (https://ona.app/_next/static/chunks/app/menu/page-3c5d0c1f0a6b1e2d.js:1:23456)'
    expect(scrub(frame)).toBe(frame)
    const node = 'at listRecipes (/app/apps/api/dist/routes/recipes.js:120:15)'
    expect(scrub(node)).toBe(node)
  })

  it('does not mistake UUID digit groups for phone numbers', () => {
    expect(scrub('id 12345678-1234-4abc-9def-123456789012')).toBe('id 12345678-1234-4abc-9def-123456789012')
  })
})

describe('normalizeMessage', () => {
  it('groups the same error across different ids, numbers and hex ids', () => {
    const a = normalizeMessage(`Recipe ${UUID} not found after 3000ms (attempt 2)`)
    const b = normalizeMessage('Recipe 9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d not found after 4500ms (attempt 7)')
    expect(a).toBe('Recipe <uuid> not found after <n>ms (attempt <n>)')
    expect(b).toBe(a)
    expect(normalizeMessage('Object 5f3e2a9bc1d4 missing')).toBe('Object <hex> missing')
    expect(normalizeMessage('pointer 0x7ffd3a2b')).toBe('pointer <hex>')
  })

  it('keeps identifiers that merely contain digits', () => {
    expect(normalizeMessage('utf8 decode failed in h1')).toBe('utf8 decode failed in h1')
  })

  it('scrubs personal data before normalising', () => {
    expect(normalizeMessage('Load failed for ana@x.com at /reset?token=abc')).toBe('Load failed for <email> at /reset')
  })

  it('collapses whitespace and caps the length at 500 chars', () => {
    expect(normalizeMessage('  multi\n   line\terror  ')).toBe('multi line error')
    expect(normalizeMessage('x'.repeat(2000)).length).toBe(500)
  })

  it('never returns an empty string', () => {
    expect(normalizeMessage('   ')).toBe('(sin mensaje)')
  })
})

describe('topStackFrame', () => {
  it('returns the first V8 frame without line:col, origin or build hashes', () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'name')",
      '    at renderMeal (https://ona.app/_next/static/chunks/app/menu/page-3c5d0c1f0a6b1e2d.js:1:2345)',
      '    at div (https://ona.app/_next/static/chunks/framework-0a1b2c3d4e5f6a7b.js:9:1)',
    ].join('\n')
    expect(topStackFrame(stack)).toBe('at renderMeal (/_next/static/chunks/app/menu/page-<hash>.js)')
  })

  it('parses Firefox / Safari frames', () => {
    const stack = 'renderMeal@https://ona.app/_next/static/chunks/app/menu/page-3c5d0c1f0a6b1e2d.js:1:2345\nx@y.js:1:1'
    expect(topStackFrame(stack)).toBe('renderMeal@/_next/static/chunks/app/menu/page-<hash>.js')
  })

  it('parses Node frames', () => {
    const stack = 'Error: boom\n    at listRecipes (/app/apps/api/dist/routes/recipes.js:120:15)\n    at Layer.handle (x.js:1:1)'
    expect(topStackFrame(stack)).toBe('at listRecipes (/app/apps/api/dist/routes/recipes.js)')
  })

  it('is stable across builds: same function in a new chunk hash, other line → same frame', () => {
    const v1 = 'E\n    at renderMeal (https://ona.app/_next/static/chunks/app/menu/page-3c5d0c1f0a6b1e2d.js:1:2345)'
    const v2 = 'E\n    at renderMeal (https://ona.app/_next/static/chunks/app/menu/page-99aa88bb77cc66dd.js:1:9876)'
    expect(topStackFrame(v1)).toBe(topStackFrame(v2))
  })

  it('returns an empty string when there is no frame', () => {
    expect(topStackFrame(undefined)).toBe('')
    expect(topStackFrame('')).toBe('')
    expect(topStackFrame('just a message')).toBe('')
  })
})

describe('fingerprint', () => {
  it('is deterministic and hex', () => {
    const fp = fingerprint('client', 'boom', 'at x (/a.js)')
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint('client', 'boom', 'at x (/a.js)')).toBe(fp)
  })

  it('differs by kind, message and frame', () => {
    const base = fingerprint('client', 'boom', 'at x (/a.js)')
    expect(fingerprint('server', 'boom', 'at x (/a.js)')).not.toBe(base)
    expect(fingerprint('client', 'bang', 'at x (/a.js)')).not.toBe(base)
    expect(fingerprint('client', 'boom', 'at y (/a.js)')).not.toBe(base)
  })
})

describe('userAgentFamily', () => {
  const cases: Array<[string, string]> = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari · iOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1', 'Chrome · iOS'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', 'Chrome · Android'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'Samsung Internet · Android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox · Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0', 'Edge · Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari · macOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Chrome · macOS'],
    ['curl/8.4.0', 'Otro · Otro'],
  ]
  it.each(cases)('%s → %s', (ua, family) => {
    expect(userAgentFamily(ua)).toBe(family)
  })

  it('is null without a user agent', () => {
    expect(userAgentFamily(undefined)).toBeNull()
    expect(userAgentFamily('')).toBeNull()
  })
})

describe('normalizeRoutePath / cleanPath', () => {
  it('turns a raw API path into a route-like pattern (ids, numbers, tokens)', () => {
    expect(normalizeRoutePath(`/menu/${UUID}/day/3?x=1`)).toBe('/menu/:id/day/:n')
    expect(normalizeRoutePath('/invites/0123456789abcdef0123456789abcdef')).toBe('/invites/:token')
  })

  it('cleanPath keeps only the scrubbed path (no origin, query or fragment), capped', () => {
    expect(cleanPath(`https://ona.app/recipes/${UUID}?utm=x#top`)).toBe(`/recipes/${UUID}`)
    expect(cleanPath('/invites/0123456789abcdef0123456789abcdef')).toBe('/invites/<token>')
    expect(cleanPath('/x/' + 'a'.repeat(1000))!.length).toBeLessThanOrEqual(300)
    expect(cleanPath(undefined)).toBeNull()
    expect(cleanPath('')).toBeNull()
  })
})

describe('buildAppErrorRow', () => {
  it('stores only scrubbed, capped fields and the user-agent family', () => {
    const row = buildAppErrorRow({
      kind: 'client',
      message: `No hay menú para ana@x.com (${UUID})`,
      stack: `Error: x\n    at f (https://ona.app/a.js:1:2)\n${'    at g (https://ona.app/b.js:1:2)\n'.repeat(500)}`,
      path: '/menu?semana=2026-10-05',
      release: 'abc123',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      userId: UUID,
    })
    expect(row.message).toBe('No hay menú para <email> (<uuid>)')
    expect(row.message).not.toContain('ana@x.com')
    expect(row.samplePath).toBe('/menu')
    expect(Buffer.byteLength(row.sampleStack!, 'utf8')).toBeLessThanOrEqual(4096)
    expect(row.userAgentFamily).toBe('Chrome · Android')
    expect(row.release).toBe('abc123')
    expect(row.lastUserId).toBe(UUID)
    expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('groups server errors without a stack by route, not into one bucket', () => {
    const a = buildAppErrorRow({ kind: 'server', message: 'HTTP 500: Internal server error', path: 'GET /recipes/:id' })
    const b = buildAppErrorRow({ kind: 'server', message: 'HTTP 500: Internal server error', path: 'POST /menu/generate' })
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('sanitises the release label and drops a non-uuid user id', () => {
    const row = buildAppErrorRow({ kind: 'client', message: 'x', release: 'v1 <script>', userId: 'not-a-uuid' })
    expect(row.release).toBe('v1script')
    expect(row.lastUserId).toBeNull()
  })
})

describe('ErrorWriteThrottle', () => {
  const opts = { maxWritesPerWindow: 3, windowMs: 60_000, coalesceMs: 60_000, maxPending: 10, writesPerFingerprint: 1 }

  it('writes the first hit of a fingerprint and coalesces repeats inside the window', () => {
    const t = new ErrorWriteThrottle(opts)
    expect(t.decide('a', 0)).toEqual({ action: 'write', extra: 0 })
    expect(t.decide('a', 1_000)).toEqual({ action: 'coalesce' })
    expect(t.decide('a', 2_000)).toEqual({ action: 'coalesce' })
    expect(t.drain()).toEqual([{ fingerprint: 'a', count: 2, lastSeen: 2_000 }])
    expect(t.drain()).toEqual([])
  })

  it('lets a fingerprint write directly a few times per window before coalescing (exact counts at normal volume)', () => {
    const t = new ErrorWriteThrottle({ ...opts, maxWritesPerWindow: 10, writesPerFingerprint: 3 })
    expect(t.decide('a', 0)).toEqual({ action: 'write', extra: 0 })
    expect(t.decide('a', 1)).toEqual({ action: 'write', extra: 0 })
    expect(t.decide('a', 2)).toEqual({ action: 'write', extra: 0 })
    expect(t.decide('a', 3)).toEqual({ action: 'coalesce' })
  })

  it('folds pending repeats into the next write once the coalesce window is over', () => {
    const t = new ErrorWriteThrottle(opts)
    t.decide('a', 0)
    t.decide('a', 10)
    t.decide('a', 20)
    expect(t.decide('a', 60_000)).toEqual({ action: 'write', extra: 2 })
    expect(t.drain()).toEqual([])
  })

  it('caps distinct writes per window globally and drops the rest', () => {
    const t = new ErrorWriteThrottle(opts)
    expect(t.decide('a', 0).action).toBe('write')
    expect(t.decide('b', 1).action).toBe('write')
    expect(t.decide('c', 2).action).toBe('write')
    expect(t.decide('d', 3).action).toBe('drop')
    expect(t.dropped).toBe(1)
    // Next window: room again.
    expect(t.decide('d', 60_003).action).toBe('write')
  })

  it('bounds the pending map: beyond maxPending, new coalescing fingerprints are dropped', () => {
    const t = new ErrorWriteThrottle({ ...opts, maxWritesPerWindow: 10, maxPending: 1 })
    t.decide('a', 0)
    t.decide('b', 0)
    expect(t.decide('a', 1)).toEqual({ action: 'coalesce' })
    expect(t.decide('b', 1)).toEqual({ action: 'drop' })
    expect(t.decide('a', 2)).toEqual({ action: 'coalesce' }) // already pending → still counted
  })
})

describe('recordAppError (throttle + sink)', () => {
  afterEach(() => {
    setAppErrorSinkForTests(null)
    resetAppErrorThrottlesForTests()
  })

  it('a loop of the same error is a few upserts plus one coalesced bump', async () => {
    const upserts: Array<[AppErrorRow, number]> = []
    const bumps: Array<[string, number]> = []
    setAppErrorSinkForTests({
      upsert: async (row, n) => void upserts.push([row, n]),
      bump: async (fp, n) => void bumps.push([fp, n]),
    })
    resetAppErrorThrottlesForTests()
    for (let i = 0; i < 50; i++) recordAppError({ kind: 'client', message: `boom ${i}`, path: '/menu' }, 1_000 + i)
    // All 50 share one fingerprint (the number is normalised away).
    expect(new Set(upserts.map(([row]) => row.fingerprint)).size).toBe(1)
    expect(upserts).toHaveLength(5)
    expect(upserts.every(([, n]) => n === 1)).toBe(true)
    await flushCoalescedErrors()
    expect(bumps).toEqual([[upserts[0][0].fingerprint, 45]])
  })

  it('a failing sink is swallowed', async () => {
    setAppErrorSinkForTests({
      upsert: async () => {
        throw new Error('db down')
      },
      bump: async () => {},
    })
    resetAppErrorThrottlesForTests()
    expect(() => recordAppError({ kind: 'server', message: 'x' })).not.toThrow()
  })
})

describe('serverRelease', () => {
  it('prefers the commit SHA, then the Railway deployment id', () => {
    expect(serverRelease({ RAILWAY_GIT_COMMIT_SHA: 'abc', RAILWAY_DEPLOYMENT_ID: 'dep' })).toBe('abc')
    expect(serverRelease({ RAILWAY_DEPLOYMENT_ID: 'dep' })).toBe('dep')
    expect(serverRelease({})).toBeNull()
  })
})
