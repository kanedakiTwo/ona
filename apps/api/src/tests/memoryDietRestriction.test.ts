/**
 * PRO-201: what the household tells Mimo it doesn't eat by diet is kept as a
 * restriction («Lo dijiste tú»), not as a dislike or a free note. Laura's
 * «vegetariano» showed as «Cosas que no le gustan · Asistente · carne,
 * pescado…» and «cocina siempre sin alcohol» as a note the menu didn't read
 * (riñones al jerez, 2026-10-16).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const setMemoryBatch = vi.fn(async (..._args: unknown[]) => ({}))
vi.mock('../services/userMemoryStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/userMemoryStore.js')>()),
  setMemoryBatch: (...args: unknown[]) => setMemoryBatch(...args),
  getMemoryForUser: vi.fn(async () => ({})),
}))
const consent = { active: true }
vi.mock('../services/healthConsent.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/healthConsent.js')>()),
  hasHealthConsent: vi.fn(async () => consent.active),
}))

import { dietRestrictionOf, divertDietFacts } from '../services/assistant/dietFacts.js'
import { skills } from '../services/assistant/skills.js'

const updateMemory = skills.find((s) => s.name === 'update_memory')!

describe('dietRestrictionOf', () => {
  it('reads the diet in the words the menu compiles', () => {
    expect(dietRestrictionOf('vegetariana')).toBe('vegetariano')
    expect(dietRestrictionOf('Somos veganos')).toBe('vegano')
    expect(dietRestrictionOf('sin carne ni pescado')).toBe('vegetariano')
    expect(dietRestrictionOf('Cocina siempre sin alcohol.')).toBe('sin alcohol')
    expect(dietRestrictionOf('alcohol')).toBe('sin alcohol')
    expect(dietRestrictionOf('en casa no comemos cerdo')).toBe('sin cerdo')
    expect(dietRestrictionOf('sin cerdo')).toBe('sin cerdo')
    expect(dietRestrictionOf('sin lactosa')).toBe('sin lactosa')
    expect(dietRestrictionOf('halal')).toBe('halal')
  })

  it('leaves tastes and notes about something else alone', () => {
    expect(dietRestrictionOf('cerdo')).toBeNull()
    expect(dietRestrictionOf('cilantro')).toBeNull()
    expect(dietRestrictionOf('pescado')).toBeNull()
    expect(dietRestrictionOf('su hija es vegetariana')).toBeNull()
    expect(dietRestrictionOf('le gusta la cocina vegetariana de vez en cuando')).toBeNull()
    expect(dietRestrictionOf('Ha comentado algo de salud sobre Coliflor gratinada; preguntar en el perfil')).toBeNull()
  })
})

describe('divertDietFacts', () => {
  it('moves the diet out of dislikes and notes into restrictions', () => {
    const r = divertDietFacts([
      { key: 'dislikes', value: ['cilantro', 'vegetariano'] },
      { key: 'notes', value: ['cocina siempre sin alcohol'] },
    ])
    expect(r.diverted).toEqual(['vegetariano', 'sin alcohol'])
    expect(r.facts).toEqual([
      { key: 'dislikes', value: ['cilantro'] },
      { key: 'restrictions', value: ['vegetariano', 'sin alcohol'], confidence: 1 },
    ])
  })

  it('adds to the restrictions already in the batch without touching the input', () => {
    const input = [
      { key: 'restrictions', value: ['sin gluten'] },
      { key: 'dislikes', value: ['sin cerdo'] },
    ]
    const r = divertDietFacts(input)
    expect(r.facts).toEqual([{ key: 'restrictions', value: ['sin gluten', 'sin cerdo'] }])
    expect(input[0].value).toEqual(['sin gluten'])
  })

  it('keeps an emptied list that removes or replaces', () => {
    const r = divertDietFacts([{ key: 'dislikes', value: ['vegano'], remove: ['ternera'] }])
    expect(r.facts[0]).toEqual({ key: 'dislikes', value: [], remove: ['ternera'] })
  })

  it('no diet → the same facts', () => {
    const facts = [{ key: 'dislikes', value: ['cerdo', 'cilantro'] }]
    expect(divertDietFacts(facts)).toEqual({ facts, diverted: [] })
  })
})

describe('update_memory saves the diet as a restriction the person said', () => {
  beforeEach(() => {
    setMemoryBatch.mockClear()
    consent.active = true
  })

  it('web chat with the consent: restriction, source manual («Lo dijiste tú»)', async () => {
    await updateMemory.handler(
      { facts: [{ key: 'dislikes', value: ['vegetariano', 'cilantro'] }, { key: 'notes', value: ['sin alcohol'] }] },
      { userId: 'u1', db: null, channel: 'text' },
    )
    expect(setMemoryBatch).toHaveBeenCalledTimes(1)
    const [, facts, source] = setMemoryBatch.mock.calls[0] as [string, Array<Record<string, unknown>>, string]
    expect(source).toBe('inferred')
    expect(facts).toEqual([
      { key: 'dislikes', value: ['cilantro'], confidence: 0.8 },
      { key: 'restrictions', value: ['vegetariano', 'sin alcohol'], confidence: 1, source: 'manual' },
    ])
  })

  it('without the consent: as it came, so the menu still reads the dislike', async () => {
    consent.active = false
    await updateMemory.handler({ facts: [{ key: 'dislikes', value: ['vegetariano'] }] }, { userId: 'u1', db: null, channel: 'text' })
    const [, facts] = setMemoryBatch.mock.calls[0] as [string, Array<Record<string, unknown>>]
    expect(facts).toEqual([{ key: 'dislikes', value: ['vegetariano'], confidence: 0.8 }])
  })

  it('WhatsApp: never a restriction (no health data there)', async () => {
    await updateMemory.handler({ facts: [{ key: 'notes', value: ['sin alcohol'] }] }, { userId: 'u1', db: null, channel: 'whatsapp' })
    const [, facts] = setMemoryBatch.mock.calls[0] as [string, Array<Record<string, unknown>>]
    expect(facts).toEqual([{ key: 'notes', value: ['sin alcohol'], confidence: 0.8 }])
  })
})
