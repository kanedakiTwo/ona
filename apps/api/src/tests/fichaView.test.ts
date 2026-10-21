/**
 * PRO-317 — «Tu ficha» as its reader sees it: one sentence per fact in
 * Spanish for whoever reads it, its topic, where it comes from, what the
 * reader may do, and the history in plain words. Plus «Corregir»: the reply
 * of the model read and checked against the type's schema.
 */
import { describe, expect, it } from 'vitest'
import { PROFILE_FACT_TYPES } from '@ona/shared'
import { changeView, canEditFact, confidenceFor, factOrigin, factSentence, factTopic, factView, howIUse, joinEs, peopleView, type FactRow } from '../services/profile/view.js'
import { readCorrection } from '../services/profile/correction.js'

const EXAMPLES: Record<string, unknown> = {
  fixed_dish: { dish: 'pizza', days: ['viernes'], meal: 'dinner' },
  skipped_meal: { days: ['sabado'], meal: 'lunch', reason: 'comen fuera' },
  dish_frequency: { dish: 'lentejas', minWeeks: 2, maxWeeks: 3 },
  affinity: { kind: 'style', target: 'la cuchara', score: 2 },
  effort: { days: ['jueves'], meal: 'dinner', activeMinutes: 15, totalMinutes: 40 },
  temporary_situation: { description: 'Sin horno hasta nuevo aviso' },
  shopping: { places: ['la frutería del barrio'], days: ['sabado'] },
  batch_cooking: { batches: true, days: ['domingo'], lunchboxes: true },
  novelty: { score: 1 },
  cooking_style: { style: 'batch' },
  protein_minimum: { scope: 'every_dish' },
  dislikes: ['cilantro', 'hígado'],
  equipment: ['horno', 'olla exprés'],
  notes: ['Cenamos tarde'],
  prep_habits: ['Pongo las legumbres en remojo la noche antes'],
  nutrition_principles: ['Aceite de oliva siempre'],
  cooking_skill: 'medium',
  weekly_budget_eur: 80,
  'household.adults': 2,
  'household.kids_2_to_10': 1,
  region: 'MD',
  time_available: { lunes: { mode: 'activo', minutes: 20 } },
  meal_times: { lunch: '14:00', dinner: '21:00' },
  cuisine_bias: { española: 70, italiana: 30 },
  restrictions: ['sin lactosa'],
  'physical.sex': 'male',
  'physical.age': 42,
  'physical.height_cm': 178,
  'physical.weight_kg': 76,
  'physical.activity_level': 'moderate',
}

describe('factSentence — every type says something, for its reader', () => {
  it('every one of the 30 types has a sentence and a topic', () => {
    for (const type of PROFILE_FACT_TYPES) {
      expect(EXAMPLES, type).toHaveProperty([type])
      expect(factSentence(type, EXAMPLES[type], 'casa'), type).toBeTruthy()
      expect(factTopic(type), type).toBeTruthy()
    }
  })

  it('speaks to whoever reads it: tú, vosotros, la otra persona', () => {
    expect(factSentence('dislikes', ['cilantro', 'hígado'], 'tu')).toBe('No te gusta cilantro y hígado')
    expect(factSentence('dislikes', ['cilantro'], 'casa')).toBe('No os gusta cilantro')
    expect(factSentence('dislikes', ['cilantro'], 'otra')).toBe('No le gusta cilantro')
    expect(factSentence('affinity', { kind: 'style', target: 'la cuchara', score: 2 }, 'tu')).toBe('Te encanta la cuchara')
    expect(factSentence('affinity', { kind: 'ingredient', target: 'el picante', score: -2 }, 'casa')).toBe('El picante, mejor no')
    expect(factSentence('batch_cooking', { batches: true, days: ['domingo'], lunchboxes: true }, 'casa')).toBe('Cocináis por tandas los domingos y dejáis táperes')
    expect(factSentence('novelty', { score: -1 }, 'tu')).toBe('Prefieres la rutina')
  })

  it('reads like the design', () => {
    expect(factSentence('fixed_dish', EXAMPLES.fixed_dish, 'casa')).toBe('Pizza los viernes en la cena')
    expect(factSentence('skipped_meal', EXAMPLES.skipped_meal, 'casa')).toBe('Los sábados no se cocina la comida (comen fuera)')
    expect(factSentence('dish_frequency', EXAMPLES.dish_frequency, 'casa')).toBe('Lentejas cada 2 o 3 semanas')
    expect(factSentence('temporary_situation', EXAMPLES.temporary_situation, 'casa')).toBe('Sin horno hasta nuevo aviso')
    expect(factSentence('temporary_situation', { description: 'De vacaciones' }, 'casa', new Date('2026-11-02T12:00:00Z'))).toBe('De vacaciones hasta el 2 de noviembre')
    expect(factSentence('protein_minimum', EXAMPLES.protein_minimum, 'tu')).toMatch(/^Proteína en cada plato: al menos 80 g/)
    expect(factSentence('region', 'MD', 'casa')).toBe('Vivís en Comunidad de Madrid')
    expect(factSentence('restrictions', ['sin lactosa'], 'tu')).toBe('Sin lactosa')
  })

  it('topics: health apart, the rest where the design puts them', () => {
    expect(factTopic('restrictions')).toBe('salud')
    expect(factTopic('physical.age')).toBe('salud')
    expect(factTopic('fixed_dish')).toBe('como_comeis')
    expect(factTopic('temporary_situation')).toBe('en_la_cocina')
    expect(factTopic('shopping')).toBe('tiempo_y_compra')
    expect(factTopic('affinity')).toBe('gustos')
    expect(factTopic('protein_minimum')).toBe('como_comes')
  })

  it('«a, b y c»', () => {
    expect(joinEs(['a'])).toBe('a')
    expect(joinEs(['a', 'b', 'c'])).toBe('a, b y c')
  })
})

describe('where it comes from, and what the reader may do', () => {
  it('origin in words', () => {
    expect(factOrigin('user', 'me', 'me', {}).label).toBe('Lo dijiste tú')
    expect(factOrigin('user', 'marta', 'me', { marta: 'Marta' }).label).toBe('Lo dijo Marta')
    expect(factOrigin('onboarding', null, 'me', {}).label).toBe('Del alta')
    expect(factOrigin('ai_nightly', null, 'me', {}).label).toBe('Lo he deducido')
  })

  it('the household, yourself and a person without an account: yes; another member: no; a child: never', () => {
    expect(canEditFact({ subjectUserId: null }, 'me', 'member')).toBe(true)
    expect(canEditFact({ subjectUserId: 'me' }, 'me', 'member')).toBe(true)
    expect(canEditFact({ subjectUserId: 'marta' }, 'me', 'owner')).toBe(false)
    expect(canEditFact({ subjectUserId: null }, 'kid', 'child')).toBe(false)
  })

  it('confidence in words, only for what Mimo deduced', () => {
    expect(confidenceFor({ origin: 'ai_nightly', confidence: 0.9 })).toBe('Casi seguro')
    expect(confidenceFor({ origin: 'ai_realtime', confidence: 0.7 })).toBe('Bastante seguro')
    expect(confidenceFor({ origin: 'ai_weekly', confidence: 0.4 })).toBe('Es una sospecha')
    expect(confidenceFor({ origin: 'user', confidence: 1 })).toBeNull()
  })

  it('«Cómo lo uso» says only what the code does', () => {
    expect(howIUse('temporary_situation', { description: 'Sin horno hasta nuevo aviso' })).toBe('Mientras tanto no te propongo nada que necesite horno.')
    expect(howIUse('dislikes', ['cilantro'])).toBe('El menú no te propone platos con eso.')
    expect(howIUse('fixed_dish', {})).toMatch(/Mimo lo tiene en cuenta/)
  })
})

const row = (over: Partial<FactRow> = {}): FactRow => ({
  id: 'f1', subjectUserId: null, subjectPersonId: null, type: 'fixed_dish', value: { dish: 'pizza', days: ['viernes'], meal: 'dinner' },
  origin: 'user', confidence: 1, evidence: [], validUntil: null, status: 'active', createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-02'), ...over,
})

describe('factView, peopleView, changeView', () => {
  it('a fact as the screen shows it', () => {
    const v = factView(row(), { viewerId: 'me', viewerRole: 'owner', actorUserId: 'me', names: {} })
    expect(v).toMatchObject({ id: 'f1', subjectKey: 'casa', topic: 'como_comeis', sentence: 'Pizza los viernes en la cena', origin: 'tu', originLabel: 'Lo dijiste tú', canEdit: true, health: false, temporary: false })
    expect(factView(row({ subjectUserId: 'marta', type: 'dislikes', value: ['ajo'] }), { viewerId: 'me', viewerRole: 'owner', actorUserId: 'marta', names: { marta: 'Marta' } }))
      .toMatchObject({ subjectKey: 'u:marta', sentence: 'No le gusta ajo', originLabel: 'Lo dijo Marta', canEdit: false })
  })

  it('people: la casa, tú, the others, then the people without an account', () => {
    const people = peopleView('me', 'owner', [{ userId: 'marta', name: 'Marta' }, { userId: 'me', name: 'miguel' }], [{ id: 'p1', alias: 'el pequeño', ageBand: '6-12' }])
    expect(people.map((p) => [p.key, p.label])).toEqual([['casa', 'La casa'], ['u:me', 'Tú'], ['u:marta', 'Marta'], ['p:p1', 'El pequeño']])
    expect(people.find((p) => p.key === 'p:p1')).toMatchObject({ ageBand: '6-12', canEdit: true })
  })

  it('history in the reader\'s words; Mimo\'s changes can be undone', () => {
    const at = new Date('2026-10-20T03:10:00Z')
    expect(changeView({ id: 'c1', factId: 'f1', action: 'fact_added', factType: 'fixed_dish', before: null, after: { value: { dish: 'pizza', days: ['viernes'] } }, origin: 'ai_nightly', actorUserId: null, createdAt: at }, row(), 'me'))
      .toMatchObject({ verb: 'He apuntado', sentence: 'Pizza los viernes', byMimo: true, canUndo: true })
    expect(changeView({ id: 'c2', factId: 'f1', action: 'fact_retired', factType: 'fixed_dish', before: { value: { dish: 'pizza' } }, after: null, origin: 'user', actorUserId: 'me', createdAt: at }, row(), 'me'))
      .toMatchObject({ verb: 'Olvidaste', sentence: 'Pizza', byMimo: false, canUndo: false })
    // Once the fact moved on (the reader forgot it), Mimo's «He apuntado» can no longer be undone.
    expect(changeView({ id: 'c4', factId: 'f1', action: 'fact_added', factType: 'fixed_dish', before: null, after: { value: { dish: 'pizza' } }, origin: 'ai_nightly', actorUserId: null, createdAt: at }, row({ status: 'retired' }), 'me'))
      .toMatchObject({ factId: 'f1', canUndo: false })
    expect(changeView({ id: 'c3', factId: null, action: 'portrait_updated', factType: null, before: { portrait: 'Antes' }, after: { portrait: 'Ahora' }, origin: 'ai_nightly', actorUserId: null, createdAt: at }, undefined, 'me'))
      .toMatchObject({ action: 'portrait', verb: 'He reescrito', canUndo: true })
  })
})

describe('readCorrection — the model\'s reply, checked', () => {
  it('a value that fits the type', () => {
    expect(readCorrection('dislikes', 'el cilantro y el hígado', '{"value":["cilantro","hígado"]}')).toEqual({ kind: 'value', value: ['cilantro', 'hígado'] })
  })
  it('a note when it doesn\'t fit, when the value fails the schema, or when the reply is broken', () => {
    expect(readCorrection('effort', 'solo en época de cole', '{"note":"Solo en época de cole; en verano, normal"}')).toEqual({ kind: 'note', note: 'Solo en época de cole; en verano, normal' })
    expect(readCorrection('effort', 'solo en época de cole', '{"value":{"days":["jueves"]}}')).toEqual({ kind: 'note', note: 'solo en época de cole' })
    expect(readCorrection('dislikes', 'nada', 'no sé')).toEqual({ kind: 'note', note: 'nada' })
  })
})
