/**
 * PRO-171 (LEG-17): the waitlist keeps personal data until 2027-05-16
 * (Madrid); from that day the scheduler anonymises the entries, except those
 * with the Friday newsletter on.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  WAITLIST_RETENTION_DATE,
  isWaitlistRetentionDue,
  purgeWaitlistPersonalData,
  purgeWaitlistPersonalDataIfDue,
  resetWaitlistRetentionMemo,
  type RetentionCandidate,
  type WaitlistRetentionRepo,
} from '../services/waitlistRetention.js'

interface Row {
  id: string
  email: string | null
  firstName: string | null
  supermarket: string | null
  householdSize: string
  newsletterOptIn: boolean
}

function fakeRepo(rows: Row[]): WaitlistRetentionRepo & { calls: number } {
  const repo = {
    calls: 0,
    async listExpired(): Promise<RetentionCandidate[]> {
      repo.calls++
      return rows.filter((r) => r.email && !r.newsletterOptIn).map((r) => ({ id: r.id, email: r.email! }))
    },
    async anonymise(entries: RetentionCandidate[]) {
      for (const e of entries) {
        const r = rows.find((x) => x.id === e.id)!
        Object.assign(r, { email: null, firstName: null, supermarket: null })
      }
      return entries.length
    },
  }
  return repo
}

const rowsFixture = (): Row[] => [
  { id: 'a', email: 'ana@example.com', firstName: 'Ana', supermarket: 'Mercadona', householdSize: '2', newsletterOptIn: false },
  { id: 'b', email: 'bea@example.com', firstName: 'Bea', supermarket: null, householdSize: '3-4', newsletterOptIn: true },
  { id: 'c', email: null, firstName: null, supermarket: null, householdSize: '1', newsletterOptIn: false },
]

describe('waitlist retention date (PRO-171)', () => {
  it('is 2027-05-16, six months after registration opens on 2026-11-16', () => {
    expect(WAITLIST_RETENTION_DATE).toBe('2027-05-16')
  })

  it('is due from 00:00 Madrid on 2027-05-16, not before', () => {
    // 2027-05-15 23:59 Madrid (CEST, UTC+2) = 21:59 UTC
    expect(isWaitlistRetentionDue(new Date('2027-05-15T21:59:00Z'))).toBe(false)
    // 2027-05-16 00:00 Madrid = 2027-05-15 22:00 UTC
    expect(isWaitlistRetentionDue(new Date('2027-05-15T22:00:00Z'))).toBe(true)
    expect(isWaitlistRetentionDue(new Date('2026-11-16T10:00:00Z'))).toBe(false)
    expect(isWaitlistRetentionDue(new Date('2028-01-01T10:00:00Z'))).toBe(true)
  })
})

describe('purgeWaitlistPersonalData', () => {
  it('does nothing before the date', async () => {
    const rows = rowsFixture()
    const repo = fakeRepo(rows)
    expect(await purgeWaitlistPersonalData(new Date('2027-05-15T12:00:00Z'), repo)).toBeNull()
    expect(repo.calls).toBe(0)
    expect(rows[0].email).toBe('ana@example.com')
  })

  it('from the date, removes email, name and supermarket and keeps the answers', async () => {
    const rows = rowsFixture()
    expect(await purgeWaitlistPersonalData(new Date('2027-05-16T08:00:00Z'), fakeRepo(rows))).toBe(1)
    expect(rows[0]).toEqual({ id: 'a', email: null, firstName: null, supermarket: null, householdSize: '2', newsletterOptIn: false })
  })

  it('leaves whoever has the Friday newsletter on untouched', async () => {
    const rows = rowsFixture()
    await purgeWaitlistPersonalData(new Date('2027-05-16T08:00:00Z'), fakeRepo(rows))
    expect(rows[1]).toMatchObject({ email: 'bea@example.com', firstName: 'Bea' })
  })

  it('catches a newsletter reader on the next run after they turn it off', async () => {
    const rows = rowsFixture()
    const repo = fakeRepo(rows)
    await purgeWaitlistPersonalData(new Date('2027-05-16T08:00:00Z'), repo)
    rows[1].newsletterOptIn = false
    expect(await purgeWaitlistPersonalData(new Date('2027-06-01T08:00:00Z'), repo)).toBe(1)
    expect(rows[1].email).toBeNull()
  })
})

describe('purgeWaitlistPersonalDataIfDue (scheduler)', () => {
  beforeEach(() => resetWaitlistRetentionMemo())

  it('runs at most once per Madrid day', async () => {
    const repo = fakeRepo(rowsFixture())
    expect(await purgeWaitlistPersonalDataIfDue(new Date('2027-05-16T08:00:00Z'), repo)).toBe(1)
    expect(await purgeWaitlistPersonalDataIfDue(new Date('2027-05-16T20:00:00Z'), repo)).toBeNull()
    expect(repo.calls).toBe(1)
    expect(await purgeWaitlistPersonalDataIfDue(new Date('2027-05-17T08:00:00Z'), repo)).toBe(0)
    expect(repo.calls).toBe(2)
  })

  it('never touches the database before the date', async () => {
    const repo = fakeRepo(rowsFixture())
    expect(await purgeWaitlistPersonalDataIfDue(new Date('2026-12-01T08:00:00Z'), repo)).toBeNull()
    expect(repo.calls).toBe(0)
  })
})
