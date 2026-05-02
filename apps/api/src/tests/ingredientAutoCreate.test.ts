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
  it('returns Foundation/SR Legacy candidates first, drops Branded', async () => {
    const client = makeMockClient({
      search: [
        { fdcId: 9, description: 'Branded capers', dataType: 'Branded' },
        { fdcId: 3, description: 'Capers FNDDS', dataType: 'Survey (FNDDS)' },
        { fdcId: 1, description: 'Capers, canned', dataType: 'Foundation' },
        { fdcId: 2, description: 'Capers, drained', dataType: 'SR Legacy' },
      ],
      profiles: { 1: PROFILE_FOUNDATION, 2: PROFILE_SR, 3: PROFILE_FNDDS },
    })

    const out = await suggestIngredient('alcaparras', { client, limit: 5 })

    expect(out.normalizedName).toBe('alcaparras')
    // Branded must be gone.
    expect(out.candidates.find(c => c.dataType === 'Branded')).toBeUndefined()
    // First two are Foundation / SR Legacy in that priority order.
    expect(out.candidates[0].dataType).toBe('Foundation')
    expect(out.candidates[1].dataType).toBe('SR Legacy')
    // The third is the FNDDS fallback.
    expect(out.candidates[2].dataType).toBe('Survey (FNDDS)')

    // Per-100 g is propagated onto each candidate.
    expect(out.candidates[0].per100g.kcal).toBe(23)
    expect(out.candidates[0].fdcId).toBe(1)
    expect(out.candidates[0].description).toContain('Capers')
  })

  it('infers aisle from English query (capers → despensa)', async () => {
    const client = makeMockClient({
      search: [
        { fdcId: 1, description: 'Capers, canned', dataType: 'Foundation' },
      ],
      profiles: { 1: PROFILE_FOUNDATION },
    })
    const out = await suggestIngredient('alcaparras', { client })
    expect(out.suggestedAisle).toBe('despensa')
  })

  it('infers allergens from a Spanish name (salmón → pescado)', async () => {
    const client = makeMockClient({ search: [], profiles: {} })
    const out = await suggestIngredient('salmón', { client })
    expect(out.suggestedAllergens).toContain('pescado')
  })

  it('returns empty candidates gracefully when USDA finds nothing', async () => {
    const client = makeMockClient({ search: [], profiles: {} })
    const out = await suggestIngredient('xyzzy-not-real', { client })
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
    const out = await suggestIngredient('alcaparras', { client })
    expect(out.candidates.map(c => c.fdcId)).toEqual([1])
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
