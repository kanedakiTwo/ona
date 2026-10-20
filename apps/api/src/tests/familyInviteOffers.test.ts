/**
 * «Familia en el mismo hogar» (D-088): the invitation is offered once in the
 * sign-up (2 adults or more) and once the first time the shopping list
 * opens (PRO-261); never to a household that already has 2 people.
 */
import { describe, expect, it } from 'vitest'
import { familyOfferDue, parseFamilyOfferState, type FamilyOfferInput } from '../services/familyInviteOffers.js'

const base = (over: Partial<FamilyOfferInput> = {}): FamilyOfferInput => ({
  state: {},
  members: 1,
  isOwner: true,
  adults: 2,
  ...over,
})

describe('familyOfferDue (sign-up and list)', () => {
  it('shows in the sign-up and in the list to a one-person household with 2 adults or more', () => {
    expect(familyOfferDue('alta', base())).toBe(true)
    expect(familyOfferDue('compra', base())).toBe(true)
    expect(familyOfferDue('compra', base({ adults: 4 }))).toBe(true)
  })

  it('only once per moment', () => {
    expect(familyOfferDue('alta', base({ state: { alta: '2026-10-20T08:00:00.000Z' } }))).toBe(false)
    expect(familyOfferDue('compra', base({ state: { compra: '2026-10-20T08:00:00.000Z' } }))).toBe(false)
    // One moment doesn't spend the other.
    expect(familyOfferDue('compra', base({ state: { alta: '2026-10-20T08:00:00.000Z' } }))).toBe(true)
  })

  it('never to a household that already has 2 people, nor to a member who is not the owner', () => {
    expect(familyOfferDue('alta', base({ members: 2 }))).toBe(false)
    expect(familyOfferDue('compra', base({ members: 3 }))).toBe(false)
    expect(familyOfferDue('compra', base({ isOwner: false }))).toBe(false)
  })

  it('never with 1 adult', () => {
    expect(familyOfferDue('alta', base({ adults: 1 }))).toBe(false)
    expect(familyOfferDue('compra', base({ adults: 1 }))).toBe(false)
  })

  it('a «no» to Mimo’s offer turns off the list one too', () => {
    expect(familyOfferDue('compra', base({ state: { mimoDeclined: '2026-10-20T08:00:00.000Z' } }))).toBe(false)
  })
})

describe('parseFamilyOfferState', () => {
  it('keeps only the known moments with a string date', () => {
    expect(parseFamilyOfferState({ alta: '2026-10-20', compra: 3, otro: 'x' })).toEqual({ alta: '2026-10-20' })
    expect(parseFamilyOfferState(null)).toEqual({})
    expect(parseFamilyOfferState('x')).toEqual({})
  })
})
