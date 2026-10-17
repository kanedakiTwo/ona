/**
 * PRO-150 — the ficha del hogar's data model (specs/household-profile.md):
 * Zod schemas, minors without names, health rules, visibility per fact and
 * the user_memories → ficha mapping.
 */
import { describe, expect, it } from 'vitest'
import {
  MEMORY_KEYS,
  PROFILE_FACT_TYPES,
  PROFILE_FACT_VALUE_SCHEMAS,
  canSeeProfileFact,
  canWriteProfileFact,
  householdPersonSchema,
  householdPortraitSchema,
  isAllowedMinorAlias,
  profileFactSchema,
  profileQuestionSchema,
  profileChangeSchema,
  visibleProfileFacts,
  type ProfileViewer,
} from '@ona/shared'
import { memoryRowToProfileFact } from '../services/profileFromMemories.js'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const P1 = '33333333-3333-4333-8333-333333333333'
const H = '44444444-4444-4444-8444-444444444444'

const base = { subject: { kind: 'household' as const }, origin: 'user' as const, confidence: 1 }

describe('fact types', () => {
  it('keep every user_memories key and add the new ones', () => {
    for (const k of MEMORY_KEYS) expect(PROFILE_FACT_TYPES).toContain(k)
    for (const k of ['fixed_dish', 'skipped_meal', 'dish_frequency', 'affinity', 'effort', 'temporary_situation', 'shopping', 'batch_cooking', 'novelty']) {
      expect(PROFILE_FACT_TYPES).toContain(k)
    }
    for (const t of PROFILE_FACT_TYPES) expect(PROFILE_FACT_VALUE_SCHEMAS[t], t).toBeDefined()
  })

  it('accept the examples of the design', () => {
    const ok = (type: string, value: unknown) =>
      expect(profileFactSchema.safeParse({ ...base, type, value }).success, `${type} ${JSON.stringify(value)}`).toBe(true)
    ok('fixed_dish', { dish: 'pizza', days: ['viernes'], meal: 'dinner' })
    ok('skipped_meal', { days: ['sabado', 'domingo'], meal: 'lunch', reason: 'el fin de semana no se cocina' })
    ok('dish_frequency', { dish: 'coliflor gratinada', minWeeks: 6, maxWeeks: 10 })
    ok('affinity', { kind: 'style', target: 'de cuchara', score: 2 })
    ok('affinity', { kind: 'ingredient', target: 'fruta en platos salados', score: -1 })
    ok('effort', { days: ['lunes', 'martes'], meal: 'dinner', activeMinutes: 15, totalMinutes: 180 })
    ok('temporary_situation', { description: 'sin horno' })
    ok('shopping', { places: ['frutería del barrio'], days: ['sabado'] })
    ok('batch_cooking', { batches: true, days: ['domingo'], lunchboxes: true })
    ok('novelty', { score: -2 })
    ok('dislikes', ['cilantro'])
  })

  it('reject bad values', () => {
    const bad = (type: string, value: unknown) =>
      expect(profileFactSchema.safeParse({ ...base, type, value }).success, `${type} ${JSON.stringify(value)}`).toBe(false)
    bad('affinity', { kind: 'style', target: 'cuchara', score: 3 })
    bad('dish_frequency', { dish: 'x', minWeeks: 10, maxWeeks: 6 })
    bad('effort', { days: ['lunes'], meal: 'dinner', activeMinutes: 60, totalMinutes: 30 })
    bad('fixed_dish', { dish: 'pizza', day: 'viernes' })
    bad('dislikes', 'cilantro')
    expect(profileFactSchema.safeParse({ ...base, type: 'no_such_type', value: 1 }).success).toBe(false)
  })

  it('confidence is 0..1 and origin one of the five', () => {
    const v = { ...base, type: 'novelty', value: { score: 0 } }
    expect(profileFactSchema.safeParse({ ...v, confidence: 1.2 }).success).toBe(false)
    expect(profileFactSchema.safeParse({ ...v, origin: 'inferred' }).success).toBe(false)
    const parsed = profileFactSchema.parse(v)
    expect(parsed).toMatchObject({ status: 'active', evidence: [], validUntil: null })
  })

  it('evidence carries signal, date and summary', () => {
    const v = { ...base, type: 'temporary_situation', value: { description: 'sin horno' }, validUntil: '2026-11-02T00:00:00+01:00' }
    expect(profileFactSchema.safeParse({ ...v, evidence: [{ signal: 'whatsapp', date: '2026-10-16', summary: 'Lo dijo por WhatsApp' }] }).success).toBe(true)
    expect(profileFactSchema.safeParse({ ...v, evidence: [{ signal: 'whatsapp', date: '16-10-2026', summary: 'x' }] }).success).toBe(false)
  })
})

describe('health in the ficha', () => {
  it('is never deduced by the nightly or weekly refiner', () => {
    const f = { subject: { kind: 'user', userId: U1 }, type: 'restrictions', value: ['sin gluten'], confidence: 0.6 }
    expect(profileFactSchema.safeParse({ ...f, origin: 'ai_nightly' }).success).toBe(false)
    expect(profileFactSchema.safeParse({ ...f, origin: 'ai_weekly' }).success).toBe(false)
    expect(profileFactSchema.safeParse({ ...f, origin: 'user' }).success).toBe(true)
  })

  it('is about a person, not the whole household', () => {
    expect(profileFactSchema.safeParse({ ...base, type: 'physical.age', value: 40 }).success).toBe(false)
  })

  it('keeps today’s rules: consent needed, nothing from WhatsApp', () => {
    expect(canWriteProfileFact({ type: 'restrictions', channel: 'web', hasHealthConsent: false })).toEqual({ ok: false, reason: 'health_consent_required' })
    expect(canWriteProfileFact({ type: 'restrictions', channel: 'whatsapp', hasHealthConsent: true })).toEqual({ ok: false, reason: 'health_from_whatsapp' })
    expect(canWriteProfileFact({ type: 'restrictions', channel: 'web', hasHealthConsent: true })).toEqual({ ok: true })
    expect(canWriteProfileFact({ type: 'dislikes', channel: 'whatsapp', hasHealthConsent: false })).toEqual({ ok: true })
  })
})

describe('people without an account: a minor’s name is never stored', () => {
  it('a minor gets only a generic alias', () => {
    expect(householdPersonSchema.safeParse({ alias: 'la pequeña', ageBand: '3-5' }).success).toBe(true)
    expect(householdPersonSchema.safeParse({ alias: 'hija 2', ageBand: '6-12' }).success).toBe(true)
    expect(householdPersonSchema.safeParse({ alias: 'Lucía', ageBand: '3-5' }).success).toBe(false)
    expect(householdPersonSchema.safeParse({ alias: 'la pequeña Lucía', ageBand: '3-5' }).success).toBe(false)
    expect(householdPersonSchema.safeParse({ alias: 'Pablo', ageBand: '13-17' }).success).toBe(false)
  })

  it('there is no name field at all', () => {
    expect(householdPersonSchema.safeParse({ alias: 'la pequeña', ageBand: '3-5', name: 'Lucía' }).success).toBe(false)
    expect(householdPersonSchema.safeParse({ alias: 'la abuela', ageBand: 'adulto', name: 'Carmen' }).success).toBe(false)
  })

  it('an adult without an account may have any short alias', () => {
    expect(householdPersonSchema.safeParse({ alias: 'la abuela', ageBand: 'adulto' }).success).toBe(true)
    expect(householdPersonSchema.safeParse({ alias: 'x'.repeat(41), ageBand: 'adulto' }).success).toBe(false)
    expect(isAllowedMinorAlias('El Mayor')).toBe(true)
  })
})

describe('portrait, questions and history', () => {
  it('the portrait has at most 250 words', () => {
    const p = { version: 1, model: 'claude-sonnet-5-5', generatedAt: '2026-10-17T03:00:00+02:00' }
    expect(householdPortraitSchema.safeParse({ ...p, text: 'palabra '.repeat(250) }).success).toBe(true)
    expect(householdPortraitSchema.safeParse({ ...p, text: 'palabra '.repeat(251) }).success).toBe(false)
  })

  it('questions and changes validate', () => {
    expect(profileQuestionSchema.safeParse({ subject: { kind: 'household' }, question: '¿Seguís sin horno?', factType: 'temporary_situation', origin: 'ai_nightly' }).success).toBe(true)
    expect(profileChangeSchema.safeParse({ action: 'fact_retired', factType: 'temporary_situation', before: { description: 'sin horno' }, reason: 'Ya tienen horno', origin: 'user' }).success).toBe(true)
    expect(profileChangeSchema.safeParse({ action: 'deleted', reason: 'x', origin: 'user' }).success).toBe(false)
  })
})

describe('visibility per fact (Miguel, 2026-10-16)', () => {
  const facts = [
    { id: 'a', type: 'restrictions', subjectUserId: U1 },
    { id: 'b', type: 'physical.weight_kg', subjectUserId: U2 },
    { id: 'c', type: 'dislikes', subjectUserId: U1 },
    { id: 'd', type: 'equipment', subjectUserId: null },
    { id: 'e', type: 'restrictions', subjectUserId: null },
  ]
  const ids = (v: ProfileViewer) => visibleProfileFacts(facts, v).map((f) => f.id)

  it('health of a person with an account: only that person', () => {
    expect(ids({ kind: 'member', userId: U1, role: 'owner' })).toEqual(['a', 'c', 'd', 'e'])
    expect(ids({ kind: 'member', userId: U2, role: 'member' })).toEqual(['b', 'c', 'd', 'e'])
  })

  it('the generator and Mimo see everything; child members nothing', () => {
    expect(ids({ kind: 'system' })).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(ids({ kind: 'member', userId: U1, role: 'child' })).toEqual([])
    expect(canSeeProfileFact(facts[0], { kind: 'member', userId: U2, role: 'owner' })).toBe(false)
  })
})

describe('user_memories → ficha', () => {
  const row = {
    id: P1, userId: U1, key: 'dislikes', value: ['cilantro'], source: 'inferred', confidence: 0.8,
    updatedAt: new Date('2026-10-15T23:30:00Z'), householdId: H,
  }

  it('keeps the origin, the confidence and says where it came from', () => {
    expect(memoryRowToProfileFact(row)).toEqual({
      householdId: H,
      subjectUserId: U1,
      type: 'dislikes',
      value: ['cilantro'],
      origin: 'ai_realtime',
      confidence: 0.8,
      evidence: [{ signal: 'user_memories', date: '2026-10-16', summary: 'Copiado de la memoria de Mimo (lo dedujo Mimo en una conversación)' }],
      sourceMemoryId: P1,
    })
    expect(memoryRowToProfileFact({ ...row, source: 'manual' })?.origin).toBe('user')
    expect(memoryRowToProfileFact({ ...row, source: 'onboarding' })?.origin).toBe('onboarding')
  })

  it('kitchen and house keys are about the household; the rest, about the user', () => {
    expect(memoryRowToProfileFact({ ...row, key: 'equipment' })?.subjectUserId).toBeNull()
    expect(memoryRowToProfileFact({ ...row, key: 'household.adults', value: 2 })?.subjectUserId).toBeNull()
    expect(memoryRowToProfileFact({ ...row, key: 'restrictions' })?.subjectUserId).toBe(U1)
  })

  it('every copied fact passes the ficha schema', () => {
    for (const source of ['manual', 'onboarding', 'inferred']) {
      const f = memoryRowToProfileFact({ ...row, key: 'restrictions', source })!
      const subject = f.subjectUserId ? { kind: 'user' as const, userId: f.subjectUserId } : { kind: 'household' as const }
      expect(profileFactSchema.safeParse({ subject, type: f.type, value: f.value, origin: f.origin, confidence: f.confidence, evidence: f.evidence }).success).toBe(true)
    }
  })

  it('a user without a household is skipped', () => {
    expect(memoryRowToProfileFact({ ...row, householdId: null })).toBeNull()
  })
})
