/**
 * PRO-21 (RGPD art. 9): health data only with explicit consent; withdrawing
 * it deletes the data. Pure rules here; the DB round-trip is in
 * healthConsentRoute.smoke.ts and the UI in e2e/health-consent.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  HEALTH_CONSENT_VERSION,
  isHealthConsentActive,
  isHealthMemoryKey,
  needsHealthConsentPrompt,
} from '@ona/shared'
import { stripHealthFromTemplate, stripHealthProfileFields } from '../services/healthConsent.js'

describe('health consent rules', () => {
  it('pins the consent text version', () => {
    expect(HEALTH_CONSENT_VERSION).toBe('salud-v1-2026-10')
  })

  it('is active only when given and not withdrawn afterwards', () => {
    expect(isHealthConsentActive(null, null)).toBe(false)
    expect(isHealthConsentActive('2026-10-09T10:00:00Z', null)).toBe(true)
    expect(isHealthConsentActive('2026-10-09T10:00:00Z', '2026-10-10T10:00:00Z')).toBe(false)
    expect(isHealthConsentActive('2026-10-11T10:00:00Z', '2026-10-10T10:00:00Z')).toBe(true)
  })

  it('asks existing users once: only with data and no answer on record', () => {
    expect(needsHealthConsentPrompt({ hasHealthData: true, consentAt: null, withdrawnAt: null })).toBe(true)
    expect(needsHealthConsentPrompt({ hasHealthData: false, consentAt: null, withdrawnAt: null })).toBe(false)
    expect(needsHealthConsentPrompt({ hasHealthData: true, consentAt: '2026-10-09T10:00:00Z', withdrawnAt: null })).toBe(false)
    expect(needsHealthConsentPrompt({ hasHealthData: true, consentAt: null, withdrawnAt: '2026-10-09T10:00:00Z' })).toBe(false)
  })

  it('knows which memory keys are health data', () => {
    expect(isHealthMemoryKey('restrictions')).toBe(true)
    expect(isHealthMemoryKey('physical.weight_kg')).toBe(true)
    expect(isHealthMemoryKey('dislikes')).toBe(false)
  })

  it('strips health fields from a profile update', () => {
    expect(stripHealthProfileFields({ sex: 'male', age: 40, weight: 80, height: 180, activityLevel: 'light', restrictions: ['sin gluten'], priority: 'quick', adults: 2 }))
      .toEqual({ priority: 'quick', adults: 2 })
  })

  it('strips the health copy from the profile template blob', () => {
    expect(stripHealthFromTemplate({ physical: { age: 40 }, preferences: { restrictions: ['sin gluten'], priority: 'quick' }, mealTemplate: { lunes: {} } }))
      .toEqual({ preferences: { restrictions: [], priority: 'quick' }, mealTemplate: { lunes: {} } })
    expect(stripHealthFromTemplate([])).toEqual([])
  })
})
