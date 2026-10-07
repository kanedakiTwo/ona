/**
 * Contract test: web error reporter payload ↔ POST /client-errors schema.
 *
 * The reporter (apps/web/src/lib/errorReporter.ts) builds its body with
 * `buildClientErrorReport`; the API validates it with
 * `clientErrorReportSchema` and refuses bodies over `maxBodyBytes` (413).
 * If the two drift, every client error is silently rejected — the exact
 * silent-bug class recipeFormContract.test.ts exists for.
 */
import { describe, expect, it } from 'vitest'
import {
  CLIENT_ERROR_LIMITS,
  buildClientErrorReport,
  clientErrorDedupeKey,
  clientErrorReportSchema,
  isIgnorableClientError,
} from '@ona/shared'

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8')

describe('buildClientErrorReport → clientErrorReportSchema', () => {
  it('a typical browser error passes the schema', () => {
    const report = buildClientErrorReport({
      message: "Cannot read properties of undefined (reading 'name')",
      stack: "TypeError: Cannot read properties of undefined (reading 'name')\n    at renderMeal (https://ona.app/a.js:1:2)",
      path: '/menu',
      release: 'abc1234',
    })
    expect(clientErrorReportSchema.safeParse(report).success).toBe(true)
    expect(report).toMatchObject({ kind: 'client', path: '/menu', release: 'abc1234' })
  })

  it('drops the query string and fragment from the path before it leaves the browser', () => {
    const report = buildClientErrorReport({ message: 'x', path: '/reset?token=secret#frag' })
    expect(report.path).toBe('/reset')
  })

  it('huge inputs still fit the schema and the body cap', () => {
    const report = buildClientErrorReport({
      message: 'm'.repeat(100_000),
      stack: 's'.repeat(100_000),
      path: '/p'.repeat(5_000),
      release: 'r'.repeat(500),
    })
    expect(clientErrorReportSchema.safeParse(report).success).toBe(true)
    expect(bytes(report)).toBeLessThanOrEqual(CLIENT_ERROR_LIMITS.maxBodyBytes)
  })

  it('multi-byte text and escaped newlines are trimmed until the body fits', () => {
    const report = buildClientErrorReport({
      message: '🍅 ñandú '.repeat(400),
      stack: '\n\u0001🍅'.repeat(4_000),
    })
    expect(clientErrorReportSchema.safeParse(report).success).toBe(true)
    expect(bytes(report)).toBeLessThanOrEqual(CLIENT_ERROR_LIMITS.maxBodyBytes)
  })

  it('a missing or blank message becomes a placeholder, never an invalid report', () => {
    for (const message of [undefined, '', '   ', 42, null]) {
      const report = buildClientErrorReport({ message })
      expect(clientErrorReportSchema.safeParse(report).success).toBe(true)
      expect(report.message).toBe('Error sin mensaje')
    }
  })

  it('the schema rejects what the API must not accept', () => {
    expect(clientErrorReportSchema.safeParse({ kind: 'server', message: 'x' }).success).toBe(false)
    expect(clientErrorReportSchema.safeParse({ kind: 'client', message: '' }).success).toBe(false)
    expect(clientErrorReportSchema.safeParse({ kind: 'client' }).success).toBe(false)
    expect(clientErrorReportSchema.safeParse({ kind: 'client', message: 'x', stack: 3 }).success).toBe(false)
  })
})

describe('clientErrorDedupeKey', () => {
  it('is the same for the same error from the same place, different elsewhere', () => {
    const a = clientErrorDedupeKey('boom', 'Error: boom\n    at f (https://ona.app/a.js:1:2)')
    expect(clientErrorDedupeKey('boom', 'Error: boom\n    at f (https://ona.app/a.js:1:2)')).toBe(a)
    expect(clientErrorDedupeKey('boom', 'Error: boom\n    at g (https://ona.app/b.js:1:2)')).not.toBe(a)
    expect(clientErrorDedupeKey('bang', 'Error: bang\n    at f (https://ona.app/a.js:1:2)')).not.toBe(a)
  })
})

describe('isIgnorableClientError', () => {
  it('skips browser noise', () => {
    expect(isIgnorableClientError({ message: 'ResizeObserver loop completed with undelivered notifications.' })).toBe(true)
    expect(isIgnorableClientError({ message: 'Script error.' })).toBe(true)
    expect(isIgnorableClientError({ name: 'AbortError', message: 'The user aborted a request.' })).toBe(true)
    expect(isIgnorableClientError({ message: 'x', stack: 'at y (chrome-extension://abc/content.js:1:1)' })).toBe(true)
  })

  it('keeps real errors', () => {
    expect(isIgnorableClientError({ name: 'TypeError', message: 'x is undefined' })).toBe(false)
    expect(isIgnorableClientError({ name: 'ChunkLoadError', message: 'Loading chunk 123 failed.' })).toBe(false)
  })
})
