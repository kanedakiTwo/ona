/**
 * WhatsApp-first sign-up (Miguel, 2026-10-10): a new account that links
 * WhatsApp does the first steps in the chat. Mimo asks them (onboarding block
 * of the WhatsApp prompt) and finishes with complete_onboarding, which saves
 * the answers like the web onboarding (never health data) and builds the
 * first menu. The inbound side is covered in whatsappInbound.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, WHATSAPP_ONBOARDING_PROMPT } from '../services/assistant/systemPrompt.js'
import { skills } from '../services/assistant/skills.js'
import { COPY, countWord, WHATSAPP_ONBOARDING_QUESTIONS } from '../services/whatsapp/inbound.js'

const completeOnboarding = skills.find((s) => s.name === 'complete_onboarding')!

/** db.select(...).from(...).where(...).limit(1) → rows; nothing else may be called. */
function fakeDb(rows: unknown[]) {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
    update: () => {
      throw new Error('must not write')
    },
  }
}

describe('WhatsApp onboarding prompt', () => {
  it('is added only while the first steps are pending', () => {
    const pending = buildSystemPrompt('ctx', 'whatsapp', { onboarding: true })
    expect(pending).toContain(WHATSAPP_ONBOARDING_PROMPT)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/complete_onboarding/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/No preguntes por alergias/)
    expect(buildSystemPrompt('ctx', 'whatsapp')).not.toContain(WHATSAPP_ONBOARDING_PROMPT)
    expect(buildSystemPrompt('ctx', 'text', { onboarding: true })).not.toContain(WHATSAPP_ONBOARDING_PROMPT)
  })
})

describe('complete_onboarding', () => {
  it('exists, and takes no health fields', () => {
    expect(completeOnboarding).toBeDefined()
    const props = Object.keys((completeOnboarding.parameters as any).properties)
    expect(props.sort()).toEqual(['adults', 'cookingFreq', 'favoriteDishes', 'kidsCount', 'priority'])
  })

  it('saves nothing when an answer is missing and says what to ask', async () => {
    const r = await completeOnboarding.handler(
      { adults: 2, kidsCount: 0, favoriteDishes: [] },
      { userId: 'u1', db: fakeDb([{ onboardingDone: false }]) } as any,
    )
    expect(r.data).toBeNull()
    expect(r.summary).toMatch(/No he guardado nada/)
    expect(r.summary).toMatch(/cuanto cocinan/)
    // PRO-245 / D-064: favourite dishes are no longer a sign-up answer.
    expect(r.summary).not.toMatch(/plato/)
  })

  it('does nothing for an account that already did the first steps', async () => {
    const r = await completeOnboarding.handler(
      { adults: 2, kidsCount: 0, cookingFreq: 'daily', favoriteDishes: ['lentejas'] },
      { userId: 'u1', db: fakeDb([{ onboardingDone: true }]) } as any,
    )
    expect(r.data).toBeNull()
    expect(r.summary).toMatch(/ya estaban hechos/)
  })
})

describe('PRO-245: the WhatsApp sign-up asks what it announces', () => {
  it('PRO-245: the first message announces exactly as many questions as it lists, and complete_onboarding needs no more', () => {
    const m = COPY.linkedOnboarding(null)
    const announced = m.match(/solo necesito saber (\S+) cosas/)?.[1]
    const listed = m.match(/^\*\d+\.\* /gm) ?? []
    expect(listed.length).toBe(WHATSAPP_ONBOARDING_QUESTIONS.length)
    expect(announced).toBe(countWord(listed.length))
    expect(announced).toBe('dos')
    for (const q of WHATSAPP_ONBOARDING_QUESTIONS) expect(m).toContain(q)
    // The sign-up's steps: household (adults + kids) and how often they cook.
    const required = (completeOnboarding.parameters as { required: string[] }).required
    expect([...required].sort()).toEqual(['adults', 'cookingFreq', 'kidsCount'])
    expect(WHATSAPP_ONBOARDING_PROMPT).toContain('las dos unicas cosas del alta')
    expect(WHATSAPP_ONBOARDING_PROMPT).not.toMatch(/al menos un plato/)
  })
})
