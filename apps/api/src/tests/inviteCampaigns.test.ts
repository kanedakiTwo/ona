/**
 * PRO-27: closed beta + invitation links by campaign.
 *  - `registrationAccess`: during the beta only a campaign link, an invited
 *    waitlist email, a household invitation or an admin email get in;
 *    `REGISTRATION_MODE=open` lets anyone in.
 *  - `buildCampaigns`: signups, activation and week 3 per campaign in
 *    GET /admin/metrics (Miguel's circle apart from strangers).
 */
import { describe, expect, it } from 'vitest'
import { registerSchema } from '@ona/shared'
import { REGISTRATION_INVITE_REQUIRED, registrationAccess, type GateInput } from '../services/inviteCampaigns.js'
import { buildCampaigns, type MetricsInput } from '../services/businessMetrics.js'

const none: GateInput = { mode: 'invite', isAdminEmail: false, campaignOk: false, waitlistInvited: false, householdInviteOk: false }

describe('registrationAccess (closed beta)', () => {
  it('rejects anyone without an invitation', () => {
    expect(registrationAccess(none)).toBeNull()
    expect(REGISTRATION_INVITE_REQUIRED.code).toBe('REGISTRATION_INVITE_REQUIRED')
    expect(REGISTRATION_INVITE_REQUIRED.error).toMatch(/beta cerrada/)
  })

  it('lets in each of the four ways', () => {
    expect(registrationAccess({ ...none, campaignOk: true })).toBe('campaign')
    expect(registrationAccess({ ...none, waitlistInvited: true })).toBe('waitlist')
    expect(registrationAccess({ ...none, householdInviteOk: true })).toBe('household')
    expect(registrationAccess({ ...none, isAdminEmail: true })).toBe('admin')
  })

  it('REGISTRATION_MODE=open lets anyone in', () => {
    expect(registrationAccess({ ...none, mode: 'open' })).toBe('open')
  })

  it('register accepts the campaign code and the household token', () => {
    const r = registerSchema.parse({
      username: 'ana_casa', email: 'ana@example.com', password: 'secreto123', ageConfirmed: true,
      inviteCode: ' ABCD1234 ', householdInviteToken: 'tok',
    })
    expect(r.inviteCode).toBe('abcd1234')
    expect(r.householdInviteToken).toBe('tok')
  })
})

describe('buildCampaigns (GET /admin/metrics → campaigns)', () => {
  const input: MetricsInput = {
    weeks: ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'],
    currentWeek: '2026-10-05',
    activity: [
      { householdId: 'f1', week: '2026-09-14' },
      { householdId: 'f1', week: '2026-10-05' },
      { householdId: 'f2', week: '2026-09-14' },
      { householdId: 'x1', week: '2026-10-05' },
    ],
    menus: [],
    shoppingDays: [],
    signups: [
      { householdId: 'f1', day: '2026-09-15' },
      { householdId: 'f2', day: '2026-09-16' },
      { householdId: 'x1', day: '2026-10-06' },
      { householdId: 'x2', day: '2026-10-07' },
    ],
    costs: [],
  }
  const campaignOf = new Map<string, string | null>([['f1', 'familia'], ['f2', 'familia'], ['x1', 'post-linkedin'], ['x2', null]])

  it('counts signups, activation in the signup week and week 3', () => {
    const rows = buildCampaigns(input, campaignOf)
    expect(rows.find((r) => r.campaign === 'familia')).toEqual({
      campaign: 'familia', signups: 2, activated: 2, activationRate: 1, week3Eligible: 2, week3Active: 1, week3Rate: 0.5,
    })
    expect(rows.find((r) => r.campaign === 'post-linkedin')).toMatchObject({ signups: 1, activated: 1, week3Eligible: 0, week3Rate: null })
    expect(rows.find((r) => r.campaign === null)).toMatchObject({ signups: 1, activated: 0, activationRate: 0 })
  })
})
