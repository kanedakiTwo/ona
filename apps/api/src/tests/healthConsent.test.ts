/**
 * PRO-21 (RGPD art. 9): health data only with explicit consent; withdrawing
 * it deletes the data. Pure rules here; the DB round-trip is in
 * healthConsentRoute.smoke.ts and the UI in e2e/health-consent.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  HEALTH_CONSENT_VERSION,
  consentCoversReligiousDiet,
  isReligiousDiet,
  isHealthConsentActive,
  isHealthMemoryKey,
  needsHealthConsentPrompt,
} from '@ona/shared'
import { religiousDietsIn, stripHealthFromTemplate, stripHealthProfileFields, withoutUncoveredReligiousDiets } from '../services/healthConsent.js'

describe('health consent rules', () => {
  it('pins the consent text version', () => {
    expect(HEALTH_CONSENT_VERSION).toBe('salud-v2-2026-10')
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

/**
 * Halal (2026-10-25, Legal E-19): v1 of the text didn't name a diet for
 * religious reasons, so whoever consented under it is asked for the current
 * text before «halal» is saved; until then their v1 stands for the rest.
 */
describe('a diet for religious reasons', () => {
  it('only the current text (v2 on) covers it', () => {
    expect(consentCoversReligiousDiet('salud-v1-2026-10')).toBe(false)
    expect(consentCoversReligiousDiet(HEALTH_CONSENT_VERSION)).toBe(true)
    expect(consentCoversReligiousDiet(null)).toBe(false)
  })

  it('«halal», «soy musulmán», «kosher» are religious; diets and allergies are not', () => {
    for (const r of ['halal', 'Halal', 'dieta halal', 'soy musulmán', 'somos musulmanes', 'comida kosher']) expect(isReligiousDiet(r), r).toBe(true)
    for (const r of ['sin cerdo', 'sin alcohol', 'vegetariano', 'sin gluten', 'mostaza']) expect(isReligiousDiet(r), r).toBe(false)
    expect(religiousDietsIn(['sin gluten', 'halal', 3])).toEqual(['halal'])
    expect(religiousDietsIn('halal')).toEqual([])
  })

  it('the profile blob keeps everything but an uncovered religious diet', () => {
    const blob = { preferences: { restrictions: ['sin gluten', 'halal'], priority: 'quick' }, mealTemplate: {} }
    expect(withoutUncoveredReligiousDiets(blob, false)).toEqual({ preferences: { restrictions: ['sin gluten'], priority: 'quick' }, mealTemplate: {} })
    expect(withoutUncoveredReligiousDiets(blob, true)).toBe(blob)
    expect(withoutUncoveredReligiousDiets({ mealTemplate: {} }, false)).toEqual({ mealTemplate: {} })
  })
})
