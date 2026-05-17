/**
 * Integration tests for the server-side unit resolver.
 *
 * Resolution chain: table → DB cache → LLM fallback.
 * These tests use the real onatest DB for the cache layer.
 *
 * Run:
 *   DATABASE_URL=postgresql://alio@localhost:5432/onatest \
 *   npx vitest run src/tests/unitResolver.smoke.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveUnit, _setLlmClient } from '../services/unitResolver.js'
import { db } from '../db/connection.js'
import { unitConversionCache, ingredients } from '../db/schema.js'

const TEST_INGREDIENT_ID = '11111111-1111-1111-1111-111111111111'

beforeEach(async () => {
  await db.delete(unitConversionCache)
  // Ensure the test ingredient row exists (idempotent insert).
  await db.insert(ingredients).values({
    id: TEST_INGREDIENT_ID,
    name: 'test ingredient for unit resolver',
    aisle: null,
  }).onConflictDoNothing()
  // Reset any injected client between tests
  _setLlmClient(null)
})

describe('resolveUnit', () => {
  it('returns from table for "cda" without hitting cache or LLM', async () => {
    const llmSpy = vi.fn()
    _setLlmClient({ call: llmSpy })
    const result = await resolveUnit({ displayQuantity: 2, displayUnit: 'cda' })
    expect(result.source).toBe('table')
    expect(result.canonicalQuantity).toBe(30)
    expect(llmSpy).not.toHaveBeenCalled()
  })

  it('falls back to LLM for unknown term, caches it, second call hits cache', async () => {
    const llmSpy = vi.fn().mockResolvedValue({ gramsPerUnit: 8, mlPerUnit: null, rationale: 'rodaja ≈ 8g' })
    _setLlmClient({ call: llmSpy })
    const first = await resolveUnit({
      displayQuantity: 1, displayUnit: 'rodajita generosa',
      ingredient: { id: TEST_INGREDIENT_ID, name: 'limón' },
    })
    expect(first.source).toBe('llm')
    expect(first.canonicalQuantity).toBe(8)
    const second = await resolveUnit({
      displayQuantity: 1, displayUnit: 'rodajita generosa',
      ingredient: { id: TEST_INGREDIENT_ID, name: 'limón' },
    })
    expect(second.source).toBe('cache')
    expect(llmSpy).toHaveBeenCalledTimes(1)
  })

  it('generic LLM fallback (no ingredient) writes cache with NULL ingredientId', async () => {
    const llmSpy = vi.fn().mockResolvedValue({ gramsPerUnit: null, mlPerUnit: 40, rationale: '' })
    _setLlmClient({ call: llmSpy })
    const r = await resolveUnit({ displayQuantity: 1, displayUnit: 'chorretazo gigante' })
    expect(r.source).toBe('llm')
    expect(r.canonicalQuantity).toBe(40)
    expect(r.canonicalUnit).toBe('ml')
    // Second call hits cache
    const r2 = await resolveUnit({ displayQuantity: 1, displayUnit: 'chorretazo gigante' })
    expect(r2.source).toBe('cache')
  })
})
