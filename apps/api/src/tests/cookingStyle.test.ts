/**
 * PRO-217 (specs/household-profile.md, specs/auth.md): «¿Cómo cocináis en
 * casa?» — the four answers word for word, the ficha's `cooking_style` fact,
 * the sign-up payload, and Mimo's `set_cooking_style` writing through the
 * same route and body as Perfil. The write against Postgres (sign-up, Perfil
 * and Mimo land on the same fact) is cookingStyleRoute.smoke.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  COOKING_STYLES,
  COOKING_STYLE_LABELS,
  COOKING_STYLE_PATH,
  COOKING_STYLE_QUESTION,
  PROFILE_FACT_TYPES,
  PROFILE_FACT_VALUE_SCHEMAS,
  cookingStyleParts,
  onboardingDraftSchema,
  onboardingSchema,
  setCookingStyleSchema,
} from '@ona/shared'
import { setCookingStyleSkill } from '../services/assistant/householdHabitsSkills.js'
import { skills, toolsFor } from '../services/assistant/skills.js'
import { AppApiError } from '../services/assistant/appApi.js'

describe('«¿Cómo cocináis en casa?» (PRO-217)', () => {
  it('the question and its four answers, as D-069 wrote them', () => {
    expect(COOKING_STYLE_QUESTION).toBe('¿Cómo cocináis en casa?')
    expect(COOKING_STYLES.map((s) => COOKING_STYLE_LABELS[s])).toEqual([
      'Cocino cada día',
      'Cocino unos días y aprovecho para otros',
      'Batch cooking: cocino una o dos veces y dejo hecha la semana',
      'Improviso: decido cada día',
    ])
    expect(cookingStyleParts('batch')).toEqual({ title: 'Batch cooking', detail: 'Cocino una o dos veces y dejo hecha la semana' })
    expect(cookingStyleParts('daily')).toEqual({ title: 'Cocino cada día', detail: null })
  })

  it('is a fact type of the ficha, with a closed value', () => {
    expect(PROFILE_FACT_TYPES).toContain('cooking_style')
    const schema = PROFILE_FACT_VALUE_SCHEMAS.cooking_style
    expect(schema.safeParse({ style: 'batch' }).success).toBe(true)
    expect(schema.safeParse({ style: 'a veces' }).success).toBe(false)
    expect(schema.safeParse({ style: 'batch', extra: 1 }).success).toBe(false)
  })

  it('the sign-up sends it (optional, so the WhatsApp sign-up still validates) and the draft keeps it', () => {
    const base = { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'healthy' }
    expect(onboardingSchema.parse({ ...base, cookingStyle: 'cook_and_reuse' }).cookingStyle).toBe('cook_and_reuse')
    expect(onboardingSchema.parse(base).cookingStyle).toBeUndefined()
    expect(onboardingSchema.safeParse({ ...base, cookingStyle: 'nunca' }).success).toBe(false)
    const draft = { step: 4, adults: 2, kidsCount: 0, cookingFreq: 'daily', cookingStyle: 'batch', weekdayCooking: null, cookingNote: '', priority: null }
    expect(onboardingDraftSchema.parse(draft).cookingStyle).toBe('batch')
    // A draft saved before the question (no key) still resumes.
    const { cookingStyle: _omit, ...old } = draft
    expect(onboardingDraftSchema.safeParse({ ...old, step: 3 }).success).toBe(true)
    expect(onboardingDraftSchema.safeParse({ ...old, step: 6 }).success).toBe(true)
  })

  it('Mimo writes through the same route and body as Perfil, on every channel', async () => {
    expect(skills.map((s) => s.name)).toContain('set_cooking_style')
    expect(toolsFor({ mode: 'whatsapp' }).map((s) => s.name)).toContain('set_cooking_style')
    expect(toolsFor({ mode: 'text' }).map((s) => s.name)).toContain('set_cooking_style')
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const api = (async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body })
      return { style: (body as { style: string }).style, changed: true }
    }) as any
    const r = await setCookingStyleSkill.handler({ style: 'batch' }, { userId: 'u1', channel: 'whatsapp', api } as any)
    expect(calls).toEqual([{ method: 'PUT', path: COOKING_STYLE_PATH, body: { style: 'batch' } }])
    // Perfil sends exactly this body to this route (CookingStyleCard).
    expect(setCookingStyleSchema.parse(calls[0].body)).toEqual({ style: 'batch' })
    expect(r.summary).toContain('Batch cooking: cocino una o dos veces y dejo hecha la semana')
  })

  it('an unknown answer saves nothing; a child member is told why', async () => {
    const api = (async () => {
      throw new AppApiError(403, 'Solo los adultos')
    }) as any
    const bad = await setCookingStyleSkill.handler({ style: 'a veces' }, { userId: 'u1', api } as any)
    expect(bad.summary).toMatch(/No he guardado nada/)
    const child = await setCookingStyleSkill.handler({ style: 'daily' }, { userId: 'u1', api } as any)
    expect(child.summary).toMatch(/solo los adultos/)
  })
})
