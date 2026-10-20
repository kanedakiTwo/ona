/**
 * PRO-178: the web sign-up left halfway resumes where it was, and /menu sends
 * back to /onboarding only the accounts that really still need it.
 * The browser flow (two steps, log out, log in, step 3 with the answers) is
 * apps/web/e2e/onboarding-resume.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { onboardingDraftSchema } from '@ona/shared'
import { needsOnboarding } from '../services/onboarding.js'

const draft = {
  step: 3,
  adults: 3,
  kidsCount: 1,
  cookingFreq: '3_4_times',
  weekdayCooking: null,
  cookingNote: '',
  priority: null,
}

describe('onboardingDraftSchema', () => {
  it('accepts the step and the answers so far', () => {
    expect(onboardingDraftSchema.parse(draft)).toEqual(draft)
  })

  it('never carries allergies or restrictions (health data, PRO-21)', () => {
    expect(onboardingDraftSchema.safeParse({ ...draft, restrictions: ['gluten'] }).success).toBe(false)
    expect(onboardingDraftSchema.safeParse({ ...draft, healthConsent: true }).success).toBe(false)
  })

  it('rejects a step outside the six questions (PRO-217 added «¿Cómo cocináis en casa?»)', () => {
    expect(onboardingDraftSchema.safeParse({ ...draft, step: 6 }).success).toBe(true)
    expect(onboardingDraftSchema.safeParse({ ...draft, step: 7 }).success).toBe(false)
    expect(onboardingDraftSchema.safeParse({ ...draft, step: 0 }).success).toBe(false)
  })
})

describe('needsOnboarding', () => {
  it('an account that finished the sign-up never goes back', () => {
    expect(needsOnboarding({ id: 'u1', onboardingDone: true, householdOwnerId: 'u1' })).toBe(false)
    expect(needsOnboarding({ id: 'u1', onboardingDone: true, householdOwnerId: null })).toBe(false)
  })

  it('an account with its own household and the sign-up unfinished goes to /onboarding', () => {
    expect(needsOnboarding({ id: 'u1', onboardingDone: false, householdOwnerId: 'u1' })).toBe(true)
    expect(needsOnboarding({ id: 'u1', onboardingDone: null, householdOwnerId: null })).toBe(true)
  })

  it('a member who joined someone else’s household by invitation is not sent there', () => {
    expect(needsOnboarding({ id: 'u2', onboardingDone: false, householdOwnerId: 'u1' })).toBe(false)
  })
})

describe('saving the sign-up clears the draft', () => {
  it('saveOnboarding writes onboardingDraft: null', () => {
    const src = readFileSync(join(__dirname, '../services/onboarding.ts'), 'utf8')
    expect(src).toMatch(/onboardingDraft: null/)
  })

  it('the migration adds a nullable column (no existing row changes)', () => {
    const sql = readFileSync(join(__dirname, '../db/migrations/0068_onboarding_draft.sql'), 'utf8')
    expect(sql.trim()).toBe('ALTER TABLE "users" ADD COLUMN "onboarding_draft" jsonb;')
  })
})
