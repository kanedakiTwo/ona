/**
 * Smoke test for the waitlist retention purge (PRO-171, specs/waitlist.md
 * «Retention») against the real Postgres: the SQL anonymises an entry
 * without the newsletter and leaves a newsletter reader alone. Scoped to its
 * own rows (`onlyIds`), so it never touches anyone else's.
 *
 * Skips when the API isn't reachable (same gate as the other smokes).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { waitlistEntries } from '../db/schema.js'
import { createDbWaitlistRetentionRepo, purgeWaitlistPersonalData } from '../services/waitlistRetention.js'

const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const ids: string[] = []

function entry(n: number, newsletterOptIn: boolean) {
  return {
    email: `retention_${n}_${id}@test.local`,
    firstName: 'Smoke',
    supermarket: 'Mercadona',
    householdSize: '2',
    plannerRole: 'yo',
    currentMethod: 'improviso',
    platform: 'ios',
    referralCode: `RT${n}${id}`.slice(0, 12).toUpperCase(),
    consentVersion: 'smoke',
    consentAt: new Date(),
    newsletterOptIn,
    unsubscribeToken: `retention-${n}-${id}`,
  }
}

afterAll(async () => {
  if (reachable && ids.length) await db.delete(waitlistEntries).where(inArray(waitlistEntries.id, ids))
})

describe.skipIf(!reachable)('waitlist retention (real DB)', () => {
  it('anonymises entries without the newsletter from 2027-05-16 and keeps newsletter readers', async () => {
    const rows = await db
      .insert(waitlistEntries)
      .values([entry(1, false), entry(2, true)])
      .returning({ id: waitlistEntries.id })
    ids.push(...rows.map((r) => r.id))
    const repo = createDbWaitlistRetentionRepo(db, ids)

    expect(await purgeWaitlistPersonalData(new Date('2027-05-15T12:00:00Z'), repo)).toBeNull()
    expect(await purgeWaitlistPersonalData(new Date('2027-05-16T08:00:00Z'), repo)).toBe(1)

    const after = await db
      .select({ email: waitlistEntries.email, firstName: waitlistEntries.firstName, supermarket: waitlistEntries.supermarket, householdSize: waitlistEntries.householdSize, newsletterOptIn: waitlistEntries.newsletterOptIn })
      .from(waitlistEntries)
      .where(inArray(waitlistEntries.id, ids))
    const plain = after.find((r) => !r.newsletterOptIn)!
    const reader = after.find((r) => r.newsletterOptIn)!
    expect(plain).toMatchObject({ email: null, firstName: null, supermarket: null, householdSize: '2' })
    expect(reader.email).toBe(`retention_2_${id}@test.local`)
    // Idempotent: a second run finds nothing left.
    expect(await purgeWaitlistPersonalData(new Date('2027-05-17T08:00:00Z'), repo)).toBe(0)
  })
})
