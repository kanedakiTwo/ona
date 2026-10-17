/**
 * PRO-143: the web reports failed / slow API requests and ChunkLoadErrors to
 * the in-house tracker (specs/errors.md), and reloads once on a
 * ChunkLoadError. These are the pure pieces the browser runs.
 */
import { describe, expect, it } from 'vitest'
import {
  CHUNK_RELOAD_WINDOW_MS,
  apiPathPattern,
  buildApiProblemMessage,
  buildClientErrorReport,
  clientErrorReportSchema,
  isChunkLoadError,
  shouldReloadForChunkError,
  shouldReportApiStatus,
} from '@ona/shared'

describe('apiPathPattern', () => {
  it('keeps plain route words', () => {
    expect(apiPathPattern('/memory')).toBe('/memory')
    expect(apiPathPattern('/households/me/invites')).toBe('/households/me/invites')
    expect(apiPathPattern('/memory/physical.sex')).toBe('/memory/physical.sex')
  })

  it('drops the query string and the fragment', () => {
    expect(apiPathPattern('/shopping-list?from=2026-10-12&to=2026-10-18#x')).toBe('/shopping-list')
  })

  it('turns ids, numbers, tokens and free text into :id', () => {
    expect(apiPathPattern('/user/3f2c9a7e-1b2c-4d5e-8f90-123456789abc/settings')).toBe('/user/:id/settings')
    expect(apiPathPattern('/menu/42/week/2026-10-12')).toBe('/menu/:id/week/:id')
    expect(apiPathPattern('/invites/a9f3c2e18b7d6a5f4e3d2c1b0a998877')).toBe('/invites/:id')
    expect(apiPathPattern('/recipes/search/pollo%20al%20horno')).toBe('/recipes/search/:id')
    expect(apiPathPattern('/users/maria@example.com')).toBe('/users/:id')
  })

  it('never carries more than 200 chars', () => {
    expect(apiPathPattern(`/${'a/'.repeat(500)}`).length).toBeLessThanOrEqual(200)
  })
})

describe('buildApiProblemMessage', () => {
  it('describes each problem with the method and the pattern', () => {
    expect(buildApiProblemMessage({ method: 'get', path: '/memory', problem: 'status', status: 500 })).toBe(
      'API GET /memory → HTTP 500',
    )
    expect(buildApiProblemMessage({ method: 'POST', path: '/pantry', problem: 'network' })).toBe(
      'API POST /pantry: sin respuesta (red)',
    )
    expect(buildApiProblemMessage({ method: 'GET', path: '/user/123', problem: 'slow' })).toBe(
      'API GET /user/:id: más de 8 s sin respuesta',
    )
  })

  it('fits the client error report schema', () => {
    const report = buildClientErrorReport({
      message: buildApiProblemMessage({ method: 'GET', path: '/memory', problem: 'status', status: 404 }),
      path: '/profile/memoria?x=1',
    })
    expect(clientErrorReportSchema.safeParse(report).success).toBe(true)
    expect(report.path).toBe('/profile/memoria')
  })
})

describe('shouldReportApiStatus', () => {
  it('reports server errors and unexpected 4xx', () => {
    for (const s of [500, 502, 503, 400, 403, 404, 409, 429]) expect(shouldReportApiStatus(s)).toBe(true)
  })
  it('skips the expected ones: session ended (401) and form validation (422)', () => {
    expect(shouldReportApiStatus(401)).toBe(false)
    expect(shouldReportApiStatus(422)).toBe(false)
    expect(shouldReportApiStatus(200)).toBe(false)
    expect(shouldReportApiStatus(304)).toBe(false)
  })
})

describe('isChunkLoadError', () => {
  it('recognises webpack, CSS and ES-module chunk failures', () => {
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'Loading chunk 812 failed.' })).toBe(true)
    expect(isChunkLoadError({ message: 'Loading chunk app/profile/memoria/page failed.' })).toBe(true)
    expect(isChunkLoadError({ message: 'Loading CSS chunk 31 failed.' })).toBe(true)
    expect(isChunkLoadError({ message: 'Failed to fetch dynamically imported module: https://x/a.js' })).toBe(true)
    expect(isChunkLoadError({ message: 'Importing a module script failed.' })).toBe(true)
    expect(isChunkLoadError({ message: 'Failed to load chunk /_next/static/chunks/abc.js' })).toBe(true)
  })
  it('ignores everything else', () => {
    expect(isChunkLoadError({ name: 'TypeError', message: 'Failed to fetch' })).toBe(false)
    expect(isChunkLoadError({ message: 'boom' })).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError('Loading chunk 3 failed.')).toBe(true)
  })
})

describe('shouldReloadForChunkError', () => {
  const now = 1_800_000_000_000
  it('reloads when there was no recent reload', () => {
    expect(shouldReloadForChunkError(null, now)).toBe(true)
    expect(shouldReloadForChunkError(now - CHUNK_RELOAD_WINDOW_MS - 1, now)).toBe(true)
  })
  it('reloads only once: not again inside the window', () => {
    expect(shouldReloadForChunkError(now - 1_000, now)).toBe(false)
    expect(shouldReloadForChunkError(now, now)).toBe(false)
  })
  it('treats a garbage marker as no marker', () => {
    expect(shouldReloadForChunkError(Number.NaN, now)).toBe(true)
  })
})
