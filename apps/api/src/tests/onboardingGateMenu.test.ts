/**
 * PRO-1042: with a menu already made (Mimo by WhatsApp, an API sign-up),
 * /menu shows it instead of sending back to /onboarding; the sign-up still
 * to do is offered apart. The browser flow is
 * apps/web/e2e/menu-before-sign-up.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import { onboardingGate } from '../services/onboarding.js'

describe('onboardingGate', () => {
  it('without a menu, the sign-up still to do goes first', () => {
    const gate = onboardingGate({ id: 'u1', onboardingDone: false, householdOwnerId: 'u1', hasMenu: false })
    expect(gate).toMatchObject({ onboardingRequired: true, onboardingPending: true, hasMenu: false })
  })

  it('with a menu made by Mimo, /menu shows it and the sign-up is offered apart', () => {
    const gate = onboardingGate({ id: 'u1', onboardingDone: false, householdOwnerId: 'u1', hasMenu: true })
    expect(gate).toMatchObject({ onboardingRequired: false, onboardingPending: true, hasMenu: true })
  })

  it('a finished sign-up is neither required nor pending', () => {
    const gate = onboardingGate({ id: 'u1', onboardingDone: true, householdOwnerId: 'u1', hasMenu: true })
    expect(gate).toMatchObject({ onboardingRequired: false, onboardingPending: false })
  })

  it('a member of someone else’s household has nothing pending', () => {
    const gate = onboardingGate({ id: 'u2', onboardingDone: false, householdOwnerId: 'u1', hasMenu: false })
    expect(gate).toMatchObject({ onboardingRequired: false, onboardingPending: false })
  })

  it('keeps the draft where the sign-up was left', () => {
    const draft = { step: 3, adults: 1 }
    expect(onboardingGate({ id: 'u1', onboardingDone: false, householdOwnerId: null, onboardingDraft: draft }).onboardingDraft).toEqual(draft)
  })
})
