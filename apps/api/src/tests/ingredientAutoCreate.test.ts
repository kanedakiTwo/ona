/**
 * Unit tests for the ingredient auto-create service.
 *
 * Mocks the USDA client; asserts:
 *   - Branded entries are filtered out
 *   - Foundation/SR Legacy candidates rank above FNDDS
 *   - Per-100 g profile is propagated onto each candidate
 *   - Allergens / aisle are inferred from name + English query
 *   - Levenshtein helper is correct for typical typos
 *
 * Run: pnpm --filter @ona/api test
 */

import { describe, it, expect } from 'vitest'
import {
  DISH_FOOD_CATEGORIES,
  isIngredientCandidate,
  pickNutritionCandidate,
  similarIngredients,
  suggestAisleForName,
  suggestIngredient,
  levenshtein,
  normalizeForDedupe,
  translateEsToEn,
} from '../services/ingredientAutoCreate.js'
import type { UsdaClient, UsdaSearchResult, UsdaNutrientProfile } from '../services/nutrition/usdaClient.js'

function makeMockClient(opts: {
  search: UsdaSearchResult[]
  profiles: Record<number, UsdaNutrientProfile>
}): UsdaClient {
  return {
    async searchByName() {
      return opts.search
    },
    async fetchByFdcId(fdcId: number) {
      const p = opts.profiles[fdcId]
      if (!p) throw new Error(`No mock profile for fdcId=${fdcId}`)
      return p
    },
  }
}

const PROFILE_FOUNDATION: UsdaNutrientProfile = {
  fdcId: 1,
  description: 'Capers, canned',
  per100g: { kcal: 23, proteinG: 2.4, carbsG: 4.9, fatG: 0.9, fiberG: 3.2, saltG: 7.4 },
  raw: {},
}
const PROFILE_SR: UsdaNutrientProfile = {
  fdcId: 2,
  description: 'Capers, drained',
  per100g: { kcal: 25, proteinG: 2.5, carbsG: 5, fatG: 1, fiberG: 3, saltG: 7 },
  raw: {},
}
const PROFILE_FNDDS: UsdaNutrientProfile = {
  fdcId: 3,
  description: 'Capers, mixed',
  per100g: { kcal: 30, proteinG: 2, carbsG: 6, fatG: 1, fiberG: 2, saltG: 5 },
  raw: {},
}

describe('suggestIngredient', () => {
  it('returns Foundation then SR Legacy, and drops Branded and FNDDS (PRO-1125)', async () => {
    const client = makeMockClient({
      search: [
        { fdcId: 9, description: 'Branded capers', dataType: 'Branded' },
        { fdcId: 3, description: 'Capers FNDDS', dataType: 'Survey (FNDDS)' },
        { fdcId: 2, description: 'Capers, drained', dataType: 'SR Legacy' },
        { fdcId: 1, description: 'Capers, canned', dataType: 'Foundation' },
      ],
      profiles: { 1: PROFILE_FOUNDATION, 2: PROFILE_SR, 3: PROFILE_FNDDS },
    })

    const out = await suggestIngredient('alcaparras', { client, limit: 5, skipFallbacks: true })

    expect(out.normalizedName).toBe('alcaparras')
    expect(out.candidates.map((c) => c.dataType)).toEqual(['Foundation', 'SR Legacy'])

    // Per-100 g is propagated onto each candidate.
    expect(out.candidates[0].per100g.kcal).toBe(23)
    expect(out.candidates[0].fdcId).toBe(1)
    expect(out.candidates[0].description).toContain('Capers')
  })

  it('drops the dish categories: «cerdo» no longer brings pupusas or restaurant food (PRO-1125)', async () => {
    let askedTypes: string[] | undefined
    const pork: UsdaNutrientProfile = { ...PROFILE_SR, fdcId: 10, description: 'Pork, fresh, loin, raw' }
    const client: UsdaClient = {
      async searchByName(_q, opts) {
        askedTypes = opts?.preferDataTypes
        return [
          { fdcId: 11, description: 'Pupusas con chicharrón', dataType: 'Survey (FNDDS)', foodCategory: 'Mexican dishes' },
          { fdcId: 12, description: 'Restaurant, Latino, pupusas con frijoles', dataType: 'SR Legacy', foodCategory: 'Restaurant Foods' },
          { fdcId: 13, description: 'Fast foods, burrito with pork', dataType: 'SR Legacy', foodCategory: 'Fast Foods' },
          { fdcId: 14, description: 'Pork stew, Puerto Rican style', dataType: 'SR Legacy', foodCategory: 'Meals, Entrees, and Side Dishes' },
          { fdcId: 10, description: 'Pork, fresh, loin, raw', dataType: 'SR Legacy', foodCategory: 'Pork Products' },
        ]
      },
      async fetchByFdcId(id) {
        return { ...pork, fdcId: id }
      },
    }
    const out = await suggestIngredient('cerdo', { client, skipFallbacks: true })
    expect(out.candidates.map((c) => c.fdcId)).toEqual([10])
    expect(askedTypes).toEqual(['Foundation', 'SR Legacy'])
  })

  it('isIngredientCandidate: Foundation and SR Legacy ingredients only', () => {
    expect(isIngredientCandidate({ dataType: 'Foundation' })).toBe(true)
    expect(isIngredientCandidate({ dataType: 'SR Legacy', foodCategory: 'Pork Products' })).toBe(true)
    expect(isIngredientCandidate({ dataType: 'Survey (FNDDS)' })).toBe(false)
    expect(isIngredientCandidate({ dataType: 'Branded' })).toBe(false)
    expect(isIngredientCandidate({ dataType: 'toString' })).toBe(false)
    for (const foodCategory of DISH_FOOD_CATEGORIES) {
      expect(isIngredientCandidate({ dataType: 'SR Legacy', foodCategory })).toBe(false)
    }
  })

  it('infers aisle from English query (capers → despensa)', async () => {
    const client = makeMockClient({
      search: [
        { fdcId: 1, description: 'Capers, canned', dataType: 'Foundation' },
      ],
      profiles: { 1: PROFILE_FOUNDATION },
    })
    const out = await suggestIngredient('alcaparras', { client, skipFallbacks: true })
    expect(out.suggestedAisle).toBe('despensa')
  })

  it('infers allergens from a Spanish name (salmón → pescado)', async () => {
    const client = makeMockClient({ search: [], profiles: {} })
    const out = await suggestIngredient('salmón', { client, skipFallbacks: true })
    expect(out.suggestedAllergens).toContain('pescado')
  })

  it('returns empty candidates gracefully when USDA finds nothing', async () => {
    const client = makeMockClient({ search: [], profiles: {} })
    const out = await suggestIngredient('xyzzy-not-real', { client, skipFallbacks: true })
    expect(out.candidates).toEqual([])
    // Still emits aisle + allergens for the stub fallback path.
    expect(typeof out.suggestedAisle).toBe('string')
    expect(Array.isArray(out.suggestedAllergens)).toBe(true)
  })

  it('drops candidates whose per-100 g fetch fails', async () => {
    const client: UsdaClient = {
      async searchByName() {
        return [
          { fdcId: 1, description: 'Capers', dataType: 'Foundation' },
          { fdcId: 2, description: 'Capers', dataType: 'SR Legacy' },
        ]
      },
      async fetchByFdcId(fdcId: number) {
        if (fdcId === 1) return PROFILE_FOUNDATION
        throw new Error('boom')
      },
    }
    const out = await suggestIngredient('alcaparras', { client, skipFallbacks: true })
    expect(out.candidates.map(c => c.fdcId)).toEqual([1])
  })

  it('the manual search takes the automatic path: Spanish is translated (PRO-1125)', async () => {
    let receivedQuery: string | null = null
    const client: UsdaClient = {
      async searchByName(q: string) {
        receivedQuery = q
        return []
      },
      async fetchByFdcId() {
        return PROFILE_FOUNDATION
      },
    }
    const out = await suggestIngredient('manos de cerdo', { client, skipFallbacks: true, query: 'Manitas de cerdo' })
    expect(receivedQuery).toBe('pork feet raw')
    expect(out.queryUsed).toBe('pork feet raw')
  })

  it('an English manual search passes through', async () => {
    let receivedQuery: string | null = null
    const client: UsdaClient = {
      async searchByName(q: string) {
        receivedQuery = q
        return [{ fdcId: 1, description: 'White beans', dataType: 'Foundation' }]
      },
      async fetchByFdcId() {
        return PROFILE_FOUNDATION
      },
    }
    const out = await suggestIngredient('fabes de la granja', {
      client,
      skipFallbacks: true,
      query: 'white beans',
    })
    expect(receivedQuery).toBe('white beans')
    expect(out.queryUsed).toBe('white beans')
    expect(out.candidates).toHaveLength(1)
  })

  it('exposes bedcaId/descriptionEs fields with sensible defaults for USDA hits', async () => {
    const client = makeMockClient({
      search: [{ fdcId: 1, description: 'Capers, canned', dataType: 'Foundation' }],
      profiles: { 1: PROFILE_FOUNDATION },
    })
    const out = await suggestIngredient('alcaparras', { client, skipFallbacks: true })
    expect(out.candidates[0].fdcId).toBe(1)
    expect(out.candidates[0].bedcaId).toBeNull()
    // Translation skipped → null. The route still ships the raw English.
    expect(out.candidates[0].descriptionEs).toBeNull()
  })
})

describe('translateEsToEn', () => {
  it('returns the curated English query for known names', () => {
    expect(translateEsToEn('alcaparras')).toBe('capers canned')
    expect(translateEsToEn('Salmón')).toBe('salmon atlantic raw')
  })

  it('falls back to the Spanish input when unknown', () => {
    expect(translateEsToEn('foobarbaz')).toBe('foobarbaz')
  })

  it('finds the longest known name inside a longer one (PRO-1125)', () => {
    expect(translateEsToEn('pechuga de pollo')).toBe('chicken broiler breast raw')
    expect(translateEsToEn('unas manitas de cerdo')).toBe('pork feet raw')
    expect(translateEsToEn('masa de hojaldre')).toBe('puff pastry frozen ready-to-bake')
    // Whole words only: «salmorejo» is not «sal».
    expect(translateEsToEn('salmorejo cordobés')).toBe('salmorejo cordobes')
  })
})

describe('similarIngredients — «¿Es …?» before «Añadir» (PRO-1125)', () => {
  const rows = [
    { id: '1', name: 'manitas de cerdo' },
    { id: '2', name: 'cerdo picado' },
    { id: '3', name: 'lomo de cerdo' },
    { id: '4', name: 'mascarpone' },
    { id: '5', name: 'harina de trigo' },
  ]
  const names = (typed: string) => similarIngredients(typed, rows).map((r) => r.name)

  it('a word of the name, a typo or a prefix finds it', () => {
    expect(names('manitas')).toEqual(['manitas de cerdo'])
    expect(names('manita')).toEqual(['manitas de cerdo'])
    expect(names('mascarpone light')).toEqual(['mascarpone'])
    expect(names('mascarpne')).toEqual(['mascarpone'])
  })

  it('more words found go first, then the shorter name', () => {
    expect(names('manitas de cerdo guisadas')).toEqual(['manitas de cerdo', 'cerdo picado', 'lomo de cerdo'])
  })

  it('the same name with other capitals or accents is first; stopwords alone find nothing', () => {
    expect(names('Manitas de Cerdo')[0]).toBe('manitas de cerdo')
    expect(names('de la')).toEqual([])
    expect(names('xyz')).toEqual([])
  })

  it('caps the list', () => {
    expect(similarIngredients('cerdo', rows, 2)).toHaveLength(2)
  })
})

describe('suggestAisleForName', () => {
  it('infers the aisle without asking USDA', () => {
    expect(suggestAisleForName('manitas de cerdo')).toBe('proteinas')
    expect(suggestAisleForName('mascarpone')).toBe('lacteos')
    expect(suggestAisleForName('algo raro')).toBe('otros')
  })
})

describe('levenshtein + dedupe normalize', () => {
  it('handles identical strings', () => {
    expect(levenshtein('alcaparras', 'alcaparras')).toBe(0)
  })

  it('catches small typos', () => {
    expect(levenshtein('alcaparras', 'alcaparra')).toBe(1)
    expect(levenshtein('alcaparras', 'alkaparras')).toBe(1)
    expect(levenshtein('alcaparras', 'alcaparas')).toBe(1)
  })

  it('handles diacritics + case via normalizeForDedupe', () => {
    expect(normalizeForDedupe('Salmón')).toBe(normalizeForDedupe('salmon'))
    expect(normalizeForDedupe('  ALCAPARRAS  ')).toBe('alcaparras')
  })
})

describe('pickNutritionCandidate — the nutrition a new ingredient takes', () => {
  const c = (dataType: string, kcal: number) => ({
    fdcId: dataType === 'BEDCA' ? null : 1, bedcaId: dataType === 'BEDCA' ? 'b1' : null,
    description: dataType, descriptionEs: null, dataType,
    per100g: { kcal, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, saltG: 0 },
  })

  it('prefers Foundation or SR Legacy over a survey entry listed first', () => {
    expect(pickNutritionCandidate([c('Survey (FNDDS)', 1), c('SR Legacy', 2)])?.per100g.kcal).toBe(2)
  })

  it('skips an entry with no nutrients at all when another one has them (a Foundation sample with every value missing)', () => {
    expect(pickNutritionCandidate([c('Foundation', 0), c('SR Legacy', 321)])?.per100g.kcal).toBe(321)
    expect(pickNutritionCandidate([c('SR Legacy', 0)])?.per100g.kcal).toBe(0) // water: zero is its value
  })

  it('falls back to the first candidate (BEDCA) and to null when there is none', () => {
    expect(pickNutritionCandidate([c('BEDCA', 3)])?.dataType).toBe('BEDCA')
    expect(pickNutritionCandidate([])).toBeNull()
  })
})
