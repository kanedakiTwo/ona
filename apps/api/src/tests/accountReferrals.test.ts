/**
 * PRO-162: «Invitar a otro hogar» — when a sign-up counts as invited, and
 * account codes in the waitlist batch suggestion (specs/waitlist.md).
 */
import { describe, expect, it } from 'vitest'
import { invitationCounts } from '../services/accountReferrals.js'
import { suggestNextBatch, type RankableEntry } from '../services/waitlist.js'

const inviter = { userId: 'u1', email: 'ana@example.com', householdId: 'h1' }

describe('invitationCounts', () => {
  it('counts a different person joining their own household', () => {
    expect(invitationCounts(inviter, { email: 'bea@example.com', joiningHouseholdId: null })).toBe(true)
  })
  it('an unknown code never counts', () => {
    expect(invitationCounts(null, { email: 'bea@example.com', joiningHouseholdId: null })).toBe(false)
  })
  it('inviting yourself does not count (same email, any case)', () => {
    expect(invitationCounts(inviter, { email: ' ANA@example.com ', joiningHouseholdId: null })).toBe(false)
  })
  it('joining the inviter’s own household is a member, not another home', () => {
    expect(invitationCounts(inviter, { email: 'bea@example.com', joiningHouseholdId: 'h1' })).toBe(false)
    expect(invitationCounts(inviter, { email: 'bea@example.com', joiningHouseholdId: 'h2' })).toBe(true)
  })
})

describe('suggestNextBatch with account codes', () => {
  const entry = (id: string, minutes: number, referredByCode: string | null = null): RankableEntry =>
    ({
      id,
      createdAt: new Date(Date.UTC(2026, 9, 10, 10, minutes)),
      householdSize: '3-4',
      plannerRole: 'yo',
      currentMethod: 'improviso',
      referralCode: `code${id}`,
      referredByCode,
      status: 'waiting',
    }) as RankableEntry

  it('someone an account invited goes before an earlier signup', () => {
    const rows = [entry('a', 0), entry('b', 5, 'acct1234')]
    expect(suggestNextBatch(rows, 1).ids).toEqual(['a'])
    expect(suggestNextBatch(rows, 1, new Set(['acct1234'])).ids).toEqual(['b'])
  })
})
