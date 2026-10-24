/**
 * PRO-347 · «Tus alergias y tu dieta»: what is typed is read as Mimo reads it.
 * A test household wrote «nada. como d todo, el crio tb» (2026-10-22) and it
 * became a restriction. Now: «nada» saves nothing, typos are read («sin
 * glutn» → «sin gluten»), and what isn't understood is asked, not saved —
 * also without the model (no key, error).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../config/env.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../config/env.js')>()
  return { ...real, env: { ...real.env, ANTHROPIC_API_KEY: '' } }
})
const costs: unknown[][] = []
vi.mock('../services/costLedger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/costLedger.js')>()),
  recordAnthropicCost: vi.fn((...args: unknown[]) => {
    costs.push(args)
  }),
}))

import {
  RESTRICTION_READER_MODEL,
  cleanModelRestrictions,
  mergeReading,
  readByRules,
  readRestrictionText,
  readRestrictionTexts,
  restrictionsByWords,
} from '../services/restrictionReader.js'
import { compileRestrictions } from '../services/dietaryRestrictions.js'

const CATALOG = [
  { id: 'i-1', name: 'Pimiento rojo' },
  { id: 'i-2', name: 'Cilantro' },
  { id: 'i-3', name: 'Huevo' },
]
const loadCatalog = async () => CATALOG

function toolReply(input: unknown) {
  return async () => ({
    content: [{ type: 'tool_use' as const, id: 't1', name: 'read_restrictions', input }],
    usage: { input_tokens: 300, output_tokens: 40 },
  }) as any
}

describe('the reading without the model', () => {
  it('typos in allergens and diets are read', () => {
    const cases: Array<[string, string[]]> = [
      ['sin glutn', ['sin gluten']],
      ['alerjia al marisko', ['marisco']],
      ['intolerante a la lactsa', ['sin lactosa']],
      ['vejetariana', ['vegetariano']],
      ['frutos sekos y cacauetes', ['frutos secos', 'cacahuetes']],
      ['el crio es celiako', ['sin gluten']],
      ['no tomo lacteos ni guevos', ['leche (alergia)', 'huevo']],
    ]
    for (const [text, want] of cases) expect(readByRules(text, CATALOG), text).toMatchObject({ none: false, restrictions: want, understood: true })
  })

  it('«nada», «ninguna», «no tengo alergias» save nothing', () => {
    for (const text of ['nada', 'nada. como d todo, el crio tb', 'Ninguna', 'no tengo alergias', 'sin alergias']) {
      expect(readByRules(text, CATALOG), text).toEqual({ text, none: true, restrictions: [], understood: true })
    }
  })

  it('what is already known keeps its meaning, in its stored form', () => {
    expect(readByRules('nada de cerdo', CATALOG).restrictions).toEqual(['sin cerdo'])
    expect(readByRules('no como cerdo', CATALOG).restrictions).toEqual(['sin cerdo'])
    expect(readByRules('Sin gluten', CATALOG).restrictions).toEqual(['sin gluten'])
    expect(readByRules('soy celíaca', CATALOG).restrictions).toEqual(['sin gluten'])
  })

  it('a catalogue ingredient is a restriction; gibberish is asked', () => {
    expect(readByRules('intolerancia al pimiento', CATALOG)).toMatchObject({ restrictions: ['pimiento'], understood: true })
    expect(readByRules('cilantro', CATALOG)).toMatchObject({ restrictions: ['cilantro'], understood: true })
    expect(readByRules('lo de siempre xd', CATALOG)).toMatchObject({ none: false, restrictions: [], understood: false })
  })

  it('no false typo on everyday words', () => {
    expect(restrictionsByWords('un plato nuevo, me da igual')).toEqual([])
    expect(restrictionsByWords('como de todo')).toEqual([])
  })

  it('every stored form means something to the menu', () => {
    for (const r of [...restrictionsByWords('glutn lactsa lacteos guevos marisko pescao soja cacauetes vejetariano vegana cerdo'), 'sin cerdo']) {
      const rules = compileRestrictions([r])
      expect(rules.allergens.size > 0 || rules.terms.length > 1 || rules.alcohol, r).toBe(true)
    }
  })
})

describe('the reading with the model', () => {
  it('the model reads it; the words rule always adds what it finds', async () => {
    costs.length = 0
    const r = await readRestrictionText('u-1', 'al peque le sienta fatal el pimiento y no toma gluten', {
      loadCatalog,
      create: toolReply({ restrictions: ['pimiento'], none: false }),
    })
    expect(r).toMatchObject({ restrictions: ['pimiento', 'sin gluten'], understood: true, none: false })
    expect(costs).toEqual([['restriction_reader', RESTRICTION_READER_MODEL, { input_tokens: 300, output_tokens: 40 }, 'u-1']])
  })

  it('«nada» and known texts never call the model', async () => {
    const create = vi.fn()
    expect(await readRestrictionText('u-1', 'nada. como d todo, el crio tb', { loadCatalog, create })).toMatchObject({ none: true, restrictions: [] })
    expect(await readRestrictionText('u-1', 'marisco', { loadCatalog, create })).toMatchObject({ restrictions: ['marisco'] })
    expect(create).not.toHaveBeenCalled()
  })

  it('the model says none or doesn\'t understand → nothing saved', () => {
    expect(mergeReading('como de tó', { restrictions: [], none: true })).toMatchObject({ none: true, restrictions: [], understood: true })
    expect(mergeReading('lo de siempre', { restrictions: [], none: false })).toMatchObject({ understood: false, restrictions: [] })
  })

  it('the model\'s answer is cleaned to stored forms', () => {
    expect(cleanModelRestrictions(['Intolerancia a la lactosa', 'leche (alergia)', 'gluten', 'nada', 42, 'Pimiento'])).toEqual([
      'sin lactosa',
      'leche (alergia)',
      'sin gluten',
      'pimiento',
    ])
  })

  it('a failed call falls back to the rules', async () => {
    const r = await readRestrictionText('u-1', 'alerjia al marisko', {
      loadCatalog,
      create: async () => {
        throw new Error('overloaded')
      },
    })
    expect(r).toMatchObject({ restrictions: ['marisco'], understood: true })
  })

  it('several texts, each once', async () => {
    const r = await readRestrictionTexts('u-1', ['sin glutn', ' sin glutn ', '', 'nada'], { loadCatalog, create: toolReply({ restrictions: [], none: false }) })
    expect(r.map((x) => x.text)).toEqual(['sin glutn', 'nada'])
  })
})
