/**
 * PRO-263 (D-088): /admin/usage counts the household invitations sent and
 * accepted per moment (alta, lista, Mimo, Mi casa), next to the goal: of the
 * households with 2 adults or more, how many already have 2 accounts.
 */
import { describe, expect, it } from 'vitest'
import { buildFamilyInviteReport } from '../services/usageReport.js'

const inv = (source: string, shared: boolean, accepted: boolean) => ({ source, shared, accepted })

describe('buildFamilyInviteReport', () => {
  it('counts prepared, sent and accepted per moment, with totals', () => {
    const r = buildFamilyInviteReport(
      [
        inv('casa', true, true),
        inv('casa', false, false),
        inv('alta', true, false),
        inv('alta', true, true),
        inv('compra', false, false),
        inv('mimo', true, true),
      ],
      [],
    )
    expect(r.bySource).toEqual({
      alta: { prepared: 2, sent: 2, accepted: 1 },
      compra: { prepared: 1, sent: 0, accepted: 0 },
      mimo: { prepared: 1, sent: 1, accepted: 1 },
      casa: { prepared: 2, sent: 1, accepted: 1 },
    })
    expect(r.totals).toEqual({ prepared: 6, sent: 4, accepted: 3 })
  })

  it('an accepted invite counts as sent even without the tap (the link got there)', () => {
    expect(buildFamilyInviteReport([inv('casa', false, true)], []).bySource.casa).toEqual({ prepared: 1, sent: 1, accepted: 1 })
  })

  it('an unknown source counts as Mi casa; nothing is all zeros', () => {
    expect(buildFamilyInviteReport([inv('otro', true, false)], []).bySource.casa.sent).toBe(1)
    const empty = buildFamilyInviteReport([], [])
    expect(empty.totals).toEqual({ prepared: 0, sent: 0, accepted: 0 })
    expect(empty.goal).toEqual({ withTwoPlusAdults: 0, withTwoPlusAdultsAndMembers: 0, share: null })
  })

  it('the goal: households with 2 adults or more that have 2 accounts', () => {
    const r = buildFamilyInviteReport([], [
      { adults: 2, members: 1 },
      { adults: 2, members: 2 },
      { adults: 4, members: 1 },
      { adults: 1, members: 1 },
      { adults: 1, members: 2 }, // 2 accounts but 1 adult declared: not in the goal's base
    ])
    expect(r.goal).toEqual({ withTwoPlusAdults: 3, withTwoPlusAdultsAndMembers: 1, share: 0.333 })
  })
})
