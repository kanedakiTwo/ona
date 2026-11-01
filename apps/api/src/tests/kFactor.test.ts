/**
 * PRO-1018: the factor K of the invitations (specs/metrics.md «Factor K»).
 */
import { describe, expect, it } from 'vitest'
import { buildKFactor, type InviteShare } from '../services/kFactor.js'
import type { InvitedSignup } from '../services/referralRewards.js'

const W1 = '2026-10-12'
const W2 = '2026-10-19'

const share = (householdId: string | null, day: string, count = 1): InviteShare => ({ householdId, day, count })
const signup = (over: Partial<InvitedSignup> = {}): InvitedSignup => ({
  inviteeUserId: 'b',
  inviteeHouseholdId: 'hb',
  inviterCode: 'anacode1',
  inviterUserId: 'a',
  inviterHouseholdId: 'ha',
  signupDay: '2026-10-20',
  events: [],
  ...over,
})

describe('buildKFactor', () => {
  it('2 households share, 1 signs up → K = 0.5', () => {
    const { weekly } = buildKFactor([W2], [share('ha', '2026-10-19'), share('hc', '2026-10-21', 3)], [signup()])
    expect(weekly[0]).toMatchObject({ isoWeek: '2026-W43', partial: true, inviteShared: 4, inviteSignups: 1, invitingHouseholds: 2, kFactor: 0.5 })
  })

  it('joining the inviter’s own household is not a new household', () => {
    const { weekly } = buildKFactor([W2], [share('ha', '2026-10-19')], [signup({ inviteeHouseholdId: 'ha' })])
    expect(weekly[0]).toMatchObject({ inviteSignups: 0, invitingHouseholds: 1, kFactor: 0 })
  })

  it('a code that brought a sign-up counts as inviting even without a tap (forwarded link)', () => {
    const { weekly } = buildKFactor([W2], [], [signup({ inviterHouseholdId: null })])
    expect(weekly[0]).toMatchObject({ inviteShared: 0, inviteSignups: 1, invitingHouseholds: 1, kFactor: 1 })
  })

  it('the week counts its own days; cumulative runs to that Sunday; allTime takes everything', () => {
    const shares = [share('ha', '2026-10-01'), share('ha', '2026-10-13'), share('hc', '2026-10-25'), share(null, '2026-10-25')]
    const signups = [signup({ signupDay: '2026-10-14' }), signup({ inviteeUserId: 'd', inviteeHouseholdId: 'hd', inviterHouseholdId: 'hc', signupDay: '2026-10-26' })]
    const { weekly, allTime } = buildKFactor([W1, W2], shares, signups)
    expect(weekly[0]).toMatchObject({ partial: false, inviteShared: 1, inviteSignups: 1, invitingHouseholds: 1, kFactor: 1 })
    expect(weekly[0].cumulative).toEqual({ inviteShared: 2, inviteSignups: 1, invitingHouseholds: 1, kFactor: 1 })
    expect(weekly[1]).toMatchObject({ inviteShared: 2, inviteSignups: 0, invitingHouseholds: 1, kFactor: 0 })
    expect(weekly[1].cumulative).toEqual({ inviteShared: 4, inviteSignups: 1, invitingHouseholds: 2, kFactor: 0.5 })
    expect(allTime).toEqual({ inviteShared: 4, inviteSignups: 2, invitingHouseholds: 2, kFactor: 1 })
  })

  it('no inviting household → K null; two decimals', () => {
    expect(buildKFactor([W2], [], []).weekly[0].kFactor).toBeNull()
    const three = [share('h1', '2026-10-19'), share('h2', '2026-10-19'), share('h3', '2026-10-19')]
    expect(buildKFactor([W2], three, [signup({ inviterHouseholdId: 'h1' })]).weekly[0].kFactor).toBe(0.33)
  })
})
