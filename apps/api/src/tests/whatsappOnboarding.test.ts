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

  it('19-nov: the four questions go to complete_onboarding; dishes and dislikes are optional', () => {
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/las cuatro preguntas del alta/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/lunches y dinners/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/"6 cenas y 1 comida" son dinners 6 y lunches 1/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/favoriteDishes/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/dislikes/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/no insistas/)
    // Neither the priority nor who does the shopping is asked any more.
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/No preguntes por la prioridad ni por quien hace la compra/)
    expect(WHATSAPP_ONBOARDING_PROMPT).not.toMatch(/\[\[opciones: Yo \| Otra persona de casa/)
  })

  it('19-nov: the closing reply is one line and one question at most, never an excuse nor a meal already gone', () => {
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/UNA frase corta/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/como mucho UNA pregunta/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/Nunca digas que el menu se parece poco/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toContain('"¿Qué soléis cenar un martes normal?"')
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/ni hables de una comida que ya ha pasado/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/crea su receta de la casa con swap_meal/)
  })

  it('PRO-1041 + PRO-1305: an allergy told in the sign-up goes to restrictions_said; the code asks the permission after the sign-up (no link from Mimo)', () => {
    // The closing rule keeps its «no los menciones», with the way out to the next rule.
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/no los menciones, salvo lo que diga la regla siguiente/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/pasalas a complete_onboarding en restrictions_said/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/al terminar el alta el sistema le pide, con botones, permiso para apuntarlas\. No se lo pidas tu ni mandes enlaces/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/no ha puesto un plato suyo por lo que no pueden comer, diselo ahi tambien/)
    expect(WHATSAPP_ONBOARDING_PROMPT).toMatch(/Nunca dejes de hacerle el menu por eso/)
  })
})

describe('complete_onboarding', () => {
  it('exists, and takes no health fields to save (PRO-1041: the said allergies only shape the first menu)', () => {
    expect(completeOnboarding).toBeDefined()
    const props = Object.keys((completeOnboarding.parameters as any).properties)
    expect(props.sort()).toEqual(['adults', 'cookingFreq', 'cookingStyle', 'dinners', 'dislikes', 'favoriteDishes', 'kidsCount', 'lunches', 'priority', 'restrictions_said', 'shopper'])
    expect((completeOnboarding.parameters as any).properties.restrictions_said.description).toMatch(/solo a este menu y no se guardan/)
    expect((completeOnboarding.parameters as any).required).toEqual(['adults', 'kidsCount'])
    // «Lo que no entra» is tastes, never allergies.
    expect((completeOnboarding.parameters as any).properties.dislikes.description).toMatch(/Nunca alergias/)
  })

  it('how they cook keeps the web\'s four answers; the priority has no default', () => {
    const props = (completeOnboarding.parameters as any).properties
    expect(props.cookingStyle.enum).toEqual(['daily', 'cook_and_reuse', 'batch', 'improvise'])
    expect(props.priority.description).toMatch(/omitelo/)
  })

  it('saves nothing when an answer is missing and says what to ask', async () => {
    const r = await completeOnboarding.handler(
      { adults: 2, kidsCount: 0, favoriteDishes: [] },
      { userId: 'u1', db: fakeDb([{ onboardingDone: false }]) } as any,
    )
    expect(r.data).toBeNull()
    expect(r.summary).toMatch(/No he guardado nada/)
    expect(r.summary).toMatch(/que comidas cocinan en casa/)
    // The dishes are not required.
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
  it('the first message announces exactly as many questions as it lists (four since 19-nov), and complete_onboarding needs only the first two', () => {
    const m = COPY.linkedOnboarding(null)
    const announced = m.match(/solo necesito saber (\S+) cosas/)?.[1]
    const listed = m.match(/^\*\d+\.\* /gm) ?? []
    expect(listed.length).toBe(WHATSAPP_ONBOARDING_QUESTIONS.length)
    expect(announced).toBe(countWord(listed.length))
    expect(announced).toBe('cuatro')
    for (const q of WHATSAPP_ONBOARDING_QUESTIONS) expect(m).toContain(q)
    const required = (completeOnboarding.parameters as { required: string[] }).required
    expect([...required].sort()).toEqual(['adults', 'kidsCount'])
  })
})
