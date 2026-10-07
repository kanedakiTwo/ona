/**
 * Prep alerts fire on the Spanish clock, and only one process ticks at a time.
 * The server runs in UTC: before 2026-10-07 a 21:00 dinner was computed as
 * 21:00 UTC (23:00 in Madrid), so "saca la merluza" arrived 2 h late. And
 * during a Railway deploy two containers tick at once.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { resolveCookAt, withSchedulerLock } from '../services/notificationScheduler.js'
import { madridWallTimeUtc } from '../services/madridTime.js'

describe('resolveCookAt (Europe/Madrid wall clock)', () => {
  it('summer time (CEST, UTC+2): Monday 21:00 dinner → 19:00 UTC', () => {
    expect(resolveCookAt('2026-10-05', 0, 'dinner', {}).toISOString()).toBe('2026-10-05T19:00:00.000Z')
  })

  it('winter time (CET, UTC+1) and a custom meal time', () => {
    expect(resolveCookAt('2026-10-26', 2, 'lunch', { lunch: '13:30' }).toISOString()).toBe('2026-10-28T12:30:00.000Z')
  })

  it('crosses the October DST change inside the week', () => {
    // Week of 2026-10-19: Saturday 24th is CEST, Sunday 25th is CET.
    expect(resolveCookAt('2026-10-19', 5, 'dinner', {}).toISOString()).toBe('2026-10-24T19:00:00.000Z')
    expect(resolveCookAt('2026-10-19', 6, 'dinner', {}).toISOString()).toBe('2026-10-25T20:00:00.000Z')
  })

  it('a time in the spring-forward gap lands one hour later', () => {
    // 2027-03-28 02:30 doesn't exist in Madrid.
    expect(madridWallTimeUtc('2027-03-28', 2, 30).toISOString()).toBe('2027-03-28T01:30:00.000Z')
  })
})

describe('withSchedulerLock', () => {
  function fakePool(locked: boolean) {
    const queries: string[] = []
    const client = {
      query: vi.fn(async (q: string) => {
        queries.push(q)
        return { rows: [{ locked }] }
      }),
      release: vi.fn(),
    }
    return { pool: { connect: async () => client }, client, queries }
  }

  it('runs the tick and releases the lock when it gets it', async () => {
    const f = fakePool(true)
    const fn = vi.fn(async () => 'done')
    expect(await withSchedulerLock(fn, f.pool)).toBe('done')
    expect(fn).toHaveBeenCalledOnce()
    expect(f.queries.some((q) => q.includes('pg_advisory_unlock'))).toBe(true)
    expect(f.client.release).toHaveBeenCalled()
  })

  it('skips the tick when another process holds the lock', async () => {
    const f = fakePool(false)
    const fn = vi.fn(async () => 'done')
    expect(await withSchedulerLock(fn, f.pool)).toBeNull()
    expect(fn).not.toHaveBeenCalled()
    expect(f.client.release).toHaveBeenCalled()
  })

  it('unlocks even if the tick throws', async () => {
    const f = fakePool(true)
    await expect(withSchedulerLock(async () => { throw new Error('boom') }, f.pool)).rejects.toThrow('boom')
    expect(f.queries.some((q) => q.includes('pg_advisory_unlock'))).toBe(true)
  })
})
