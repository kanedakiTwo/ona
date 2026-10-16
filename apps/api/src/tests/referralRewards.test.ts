/**
 * PRO-165: invited households up to their week 3 (specs/metrics.md «Referidos»).
 */
import { describe, expect, it } from 'vitest'
import { buildReferralReport, rewardsEarned, week3Resolved, type InvitedSignup } from '../services/referralRewards.js'

const signup = (over: Partial<InvitedSignup> = {}): InvitedSignup => ({
  inviteeUserId: 'b',
  inviteeHouseholdId: 'hb',
  inviterCode: 'anacode1',
  inviterUserId: 'a',
  inviterHouseholdId: 'ha',
  signupDay: '2026-10-01',
  events: [],
  ...over,
})
const resolvedOn = (menuDay: string, listDay: string) => [
  { day: menuDay, name: 'menu_generated' },
  { day: listDay, name: 'shopping_list_viewed' },
]

describe('week3Resolved', () => {
  it('a menu and the list on days 14–20 after sign-up', () => {
    expect(week3Resolved('2026-10-01', resolvedOn('2026-10-15', '2026-10-16'))).toBe(true)
    expect(week3Resolved('2026-10-01', resolvedOn('2026-10-21', '2026-10-21'))).toBe(true)
  })
  it('not in week 2 or week 4, and not with only one of the two', () => {
    expect(week3Resolved('2026-10-01', resolvedOn('2026-10-14', '2026-10-14'))).toBe(false)
    expect(week3Resolved('2026-10-01', resolvedOn('2026-10-22', '2026-10-22'))).toBe(false)
    expect(week3Resolved('2026-10-01', [{ day: '2026-10-16', name: 'menu_generated' }])).toBe(false)
  })
})

describe('rewardsEarned', () => {
  it('an invited household with a resolved week 3 earns one; one that only signed up, no; same household as the inviter, no', () => {
    const earned = rewardsEarned([
      signup({ inviteeUserId: 'b', events: resolvedOn('2026-10-15', '2026-10-18') }),
      signup({ inviteeUserId: 'c', inviteeHouseholdId: 'hc' }),
      signup({ inviteeUserId: 'd', inviteeHouseholdId: 'ha', events: resolvedOn('2026-10-15', '2026-10-18') }),
    ])
    expect(earned).toEqual([{ inviterCode: 'anacode1', inviterUserId: 'a', inviteeUserId: 'b' }])
  })
})

describe('buildReferralReport', () => {
  it('counts by sign-up week, distinct inviters, taps by their week; never codes', () => {
    const weeks = buildReferralReport(
      [
        signup({ inviteeUserId: 'b', events: resolvedOn('2026-10-15', '2026-10-18') }),
        signup({ inviteeUserId: 'c', inviteeHouseholdId: 'hc', signupDay: '2026-10-02' }),
        signup({ inviteeUserId: 'e', inviteeHouseholdId: 'he', inviterCode: 'beacode2', signupDay: '2026-10-03' }),
        signup({ inviteeUserId: 'd', inviteeHouseholdId: 'ha' }),
      ],
      [{ day: '2026-09-30', count: 3 }],
    )
    expect(weeks).toEqual([{ week: '2026-09-28', isoWeek: '2026-W40', inviteShared: 3, signupsWithInviter: 3, week3Resolved: 1, inviters: 2 }])
    expect(JSON.stringify(weeks)).not.toMatch(/anacode1|beacode2/)
  })
})
