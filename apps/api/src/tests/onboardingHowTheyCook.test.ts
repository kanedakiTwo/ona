/**
 * 2026-11-03 (Miguel: the sign-up's questions overlapped): the web sign-up no
 * longer asks «¿Cuántas veces a la semana cocinas?» nor «¿Qué quieres que
 * Mimoia priorice?». How often they cook comes from «¿Cómo cocináis en
 * casa?», which the WhatsApp sign-up now asks too. Mimo's side (prompt and
 * complete_onboarding) is whatsappOnboarding.test.ts and
 * firstMenuWhatsApp.test.ts; the browser flow, e2e/onboarding-*.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import { COOKING_STYLES, cookingFreqForStyle, onboardingDraftSchema, onboardingSchema } from '@ona/shared'
import { onboardingCookingFreq, saveOnboarding } from '../services/onboarding.js'
import { buildAnalysisUserText } from '../services/onboardingMemoryAnalysis.js'
import { cookingContextLine } from '../services/assistant/contextLoader.js'
import { COPY, WHATSAPP_ONBOARDING_QUESTIONS } from '../services/whatsapp/inbound.js'
import { onboardingOrder, resumeStep, RESTRICTIONS_STEP, WEB_STEPS } from '../../../web/src/lib/onboardingSteps'
import { onboardingStepKey } from '../../../web/src/lib/usagePaths'

/** db.update(users).set(row).where(...).returning(...) → keeps `row`; nothing else may be called. */
function captureDb() {
  const sets: Record<string, unknown>[] = []
  return {
    sets,
    update: () => ({
      set: (row: Record<string, unknown>) => {
        sets.push(row)
        return { where: () => ({ returning: async () => [{ id: 'u1' }] }) }
      },
    }),
  }
}

describe('how often they cook, read from how they cook', () => {
  it('batch cooking is cooking little; deciding each day is the usual', () => {
    expect(COOKING_STYLES.map((s) => [s, cookingFreqForStyle(s)])).toEqual([
      ['daily', 'daily'],
      ['cook_and_reuse', '3_4_times'],
      ['batch', 'rarely'],
      ['improvise', '3_4_times'],
    ])
  })

  it('an older app that still sends how often keeps its answer', () => {
    expect(onboardingCookingFreq({ cookingStyle: 'batch' })).toBe('rarely')
    expect(onboardingCookingFreq({ cookingStyle: 'batch', cookingFreq: 'daily' })).toBe('daily')
    expect(onboardingCookingFreq({})).toBeUndefined()
  })
})

describe('the sign-up payload', () => {
  const web = { adults: 2, kidsCount: 1, restrictions: [], cookingStyle: 'cook_and_reuse', weekdayCooking: 'rapido' }

  it('the web sends no frequency and no priority', () => {
    const parsed = onboardingSchema.parse(web)
    expect(parsed.cookingFreq).toBeUndefined()
    expect(parsed.priority).toBeUndefined()
    expect(parsed.cookingStyle).toBe('cook_and_reuse')
  })

  it('without how they cook (nor how often) it is refused', () => {
    const { cookingStyle: _omit, ...none } = web
    expect(onboardingSchema.safeParse(none).success).toBe(false)
  })

  it('an app cached before the change (frequency + priority, no style) still signs up', () => {
    const old = { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'healthy' }
    expect(onboardingSchema.parse(old)).toMatchObject({ cookingFreq: 'daily', priority: 'healthy' })
  })

  it('the draft no longer needs them, and old drafts with them still resume', () => {
    const draft = { step: 3, adults: 2, kidsCount: 0, cookingStyle: null, weekdayCooking: null, cookingNote: '' }
    expect(onboardingDraftSchema.safeParse(draft).success).toBe(true)
    expect(onboardingDraftSchema.safeParse({ ...draft, step: 6, cookingFreq: 'daily', priority: 'cheap' }).success).toBe(true)
  })
})

describe('saveOnboarding', () => {
  it('stores how often from how they cook, and leaves the priority alone', async () => {
    const db = captureDb()
    await saveOnboarding('u1', { adults: 2, kidsCount: 0, cookingStyle: 'batch', favoriteDishes: [] }, db)
    expect(db.sets[0]).toMatchObject({ adults: 2, kidsCount: 0, cookingFreq: 'rarely', onboardingDone: true })
    expect(db.sets[0]).not.toHaveProperty('priority')
  })

  it('an older app\'s answers are stored as sent', async () => {
    const db = captureDb()
    await saveOnboarding('u1', { adults: 1, kidsCount: 0, cookingFreq: 'daily', priority: 'cheap', favoriteDishes: [] }, db)
    expect(db.sets[0]).toMatchObject({ cookingFreq: 'daily', priority: 'cheap' })
  })
})

describe('what the AI reads from the sign-up', () => {
  it('how they cook, in the words of the answer (not a frequency guessed from it)', () => {
    const text = buildAnalysisUserText({ adults: 2, kidsCount: 0, cookingStyle: 'batch' })
    expect(text).toContain('Cómo cocinan en casa: Batch cooking: cocino una o dos veces y dejo hecha la semana.')
    expect(text).not.toMatch(/Cuánto cocina/)
  })
})

describe('what Mimo reads about the household', () => {
  it('how they cook wins over the frequency read from it', () => {
    expect(cookingContextLine('batch', 'rarely')).toBe('como cocinan: «Batch cooking: cocino una o dos veces y dejo hecha la semana»')
    expect(cookingContextLine(null, 'rarely')).toBe('cocina raramente')
    expect(cookingContextLine(null, '3_4_times')).toBe('cocina 3-4 veces/semana')
    expect(cookingContextLine(null, null)).toBeNull()
  })
})

describe('the web questions', () => {
  it('household, how they cook, weekday time and allergies; the funnel keeps their names', () => {
    expect(WEB_STEPS.map(onboardingStepKey)).toEqual(['hogar', 'cocina', 'tiempo', 'dieta'])
    expect(onboardingOrder(false)).toEqual([1, 3, 4, RESTRICTIONS_STEP])
    // Allergies answered before «Afina tu menú»: three questions.
    expect(onboardingOrder(true)).toEqual([1, 3, 4])
  })

  it('a draft left on a step that is gone resumes on the next one', () => {
    expect(resumeStep(null)).toBe(1)
    expect([1, 2, 3, 4, 5, 6].map((step) => resumeStep({ step }))).toEqual([1, 3, 3, 4, 5, 5])
  })
})

describe('the WhatsApp sign-up asks the same as the web', () => {
  it('its second question is «¿Cómo cocináis en casa?» with the four answers', () => {
    expect(WHATSAPP_ONBOARDING_QUESTIONS).toHaveLength(2)
    const q = WHATSAPP_ONBOARDING_QUESTIONS[1]
    expect(q).toMatch(/^¿Cómo cocináis en casa:/)
    for (const way of ['cada día', 'unos días y aprovecháis para otros', 'batch cooking', 'improvisáis']) expect(q).toContain(way)
    expect(COPY.linkedOnboarding(null)).toContain(q)
  })
})
