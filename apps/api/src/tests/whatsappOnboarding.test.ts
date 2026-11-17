/**
 * WhatsApp-first sign-up (Miguel, 2026-10-10): a new account that links
 * WhatsApp does the first steps in the chat. Mimo asks them (onboarding block
 * of the WhatsApp prompt) and finishes with complete_onboarding, which saves
 * the answers like the web onboarding (never health data) and builds the
 * first menu. The inbound side is covered in whatsappInbound.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { SHOPPER_LABELS } from '@ona/shared'
import {
  buildSystemPrompt,
  WHATSAPP_ONBOARDING_FAVORITES_ASK,
  WHATSAPP_ONBOARDING_FAVORITES_KNOWN,
  WHATSAPP_ONBOARDING_PROMPT,
} from '../services/assistant/systemPrompt.js'
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

  it('2026-11-03: asks for a few favourite dishes only when «Afina tu menú» got no «Me apetece» / «Me encanta»', () => {
    const blind = buildSystemPrompt('ctx', 'whatsapp', { onboarding: true, askFavorites: true })
    expect(blind).toContain(WHATSAPP_ONBOARDING_FAVORITES_ASK)
    expect(blind).not.toContain(WHATSAPP_ONBOARDING_FAVORITES_KNOWN)
    const known = buildSystemPrompt('ctx', 'whatsapp', { onboarding: true })
    expect(known).toContain(WHATSAPP_ONBOARDING_FAVORITES_KNOWN)
    expect(known).not.toContain(WHATSAPP_ONBOARDING_FAVORITES_ASK)
    // Once, optional, with a way out, and never blocking the first menu.
    expect(WHATSAPP_ONBOARDING_FAVORITES_ASK).toMatch(/una sola vez/)
    expect(WHATSAPP_ONBOARDING_FAVORITES_ASK).toContain('[[opciones: Mejor luego]]')
    expect(WHATSAPP_ONBOARDING_FAVORITES_ASK).toMatch(/sin favoriteDishes/)
    expect(WHATSAPP_ONBOARDING_FAVORITES_ASK).toMatch(/No insistas/)
    // Not in the web chat, nor outside the sign-up.
    expect(buildSystemPrompt('ctx', 'whatsapp', { askFavorites: true })).not.toContain(WHATSAPP_ONBOARDING_FAVORITES_ASK)
  })

  it('2026-11-03: asks how they cook, never the priority', () => {
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/como cocinan en casa/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/cookingStyle/)
    expect(WHATSAPP_ONBOARDING_PROMPT).not.toMatch(/Casi a diario \| 3-4 días \| Poco/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/No preguntes por la prioridad/)
    expect(WHATSAPP_ONBOARDING_PROMPT).not.toMatch(/si no, varied/)
  })

  it('PRO-383: «¿Quién hace la compra?» only with 2 adults or more, the web\'s three answers as buttons, and the invitation as it comes', () => {
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/solo si son 2 adultos o mas/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toContain('"¿Quién hace la compra?" con [[opciones: Yo | Otra persona de casa | Nos turnamos]]')
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/Con 1 adulto no lo preguntes/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/invitacion para quien hace la compra, ponla en tu respuesta tal cual/)
    // WhatsApp buttons hold 20 characters at most.
    for (const label of Object.values(SHOPPER_LABELS)) expect(label.length).toBeLessThanOrEqual(20)
  })
})

describe('complete_onboarding', () => {
  it('exists, and takes no health fields', () => {
    expect(completeOnboarding).toBeDefined()
    const props = Object.keys((completeOnboarding.parameters as any).properties)
    expect(props.sort()).toEqual(['adults', 'cookingFreq', 'cookingStyle', 'favoriteDishes', 'kidsCount', 'priority', 'shopper'])
    // PRO-383: who does the shopping is never required (only 2 adults or more are asked).
    expect((completeOnboarding.parameters as any).required).toEqual(['adults', 'kidsCount'])
  })

  it('2026-11-03: how they cook is the web\'s four answers; the priority has no default', () => {
    const props = (completeOnboarding.parameters as any).properties
    expect(props.cookingStyle.enum).toEqual(['daily', 'cook_and_reuse', 'batch', 'improvise'])
    expect(props.cookingFreq.description).toMatch(/Solo si dice cuanto cocinan y eso no encaja/)
    expect(props.priority.description).not.toMatch(/varied\.$/)
    expect(props.priority.description).toMatch(/omitelo/)
  })

  it('saves nothing when an answer is missing and says what to ask', async () => {
    const r = await completeOnboarding.handler(
      { adults: 2, kidsCount: 0, favoriteDishes: [] },
      { userId: 'u1', db: fakeDb([{ onboardingDone: false }]) } as any,
    )
    expect(r.data).toBeNull()
    expect(r.summary).toMatch(/No he guardado nada/)
    expect(r.summary).toMatch(/como cocinan/)
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
    // The sign-up's steps: household (adults + kids) and how they cook
    // (cookingStyle, or cookingFreq for a «poco»: checked by the handler).
    const required = (completeOnboarding.parameters as { required: string[] }).required
    expect([...required].sort()).toEqual(['adults', 'kidsCount'])
    expect(WHATSAPP_ONBOARDING_PROMPT).toContain('las dos unicas cosas del alta')
    expect(WHATSAPP_ONBOARDING_PROMPT).not.toMatch(/al menos un plato/)
  })
})
