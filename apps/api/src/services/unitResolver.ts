// apps/api/src/services/unitResolver.ts
import { eq, and, isNull } from 'drizzle-orm'
import {
  resolveFromTable,
  normalizeTerm,
} from '@ona/shared'
import type { ResolveInput, ResolveResult } from '@ona/shared'
import { db } from '../db/connection.js'
import { unitConversionCache } from '../db/schema.js'
import { getDefaultLlmUnitClient, type LlmUnitClient } from './llmUnitFallback.js'

let _client: LlmUnitClient | null = null

function client(): LlmUnitClient {
  return _client ?? getDefaultLlmUnitClient()
}

/** Test-only seam to inject a mock LLM client (pass null to reset). */
export function _setLlmClient(c: LlmUnitClient | null) {
  _client = c
}

export async function resolveUnit(input: ResolveInput): Promise<ResolveResult> {
  // 1. Table — free, deterministic
  const fromTable = resolveFromTable(input)
  if (fromTable) return fromTable

  // 2. DB cache — keyed on normalized displayUnit + (ingredientId || NULL via COALESCE)
  const normalizedUnit = normalizeTerm(input.displayUnit)
  const cacheKey = input.ingredient?.id ?? null

  const cached = await db
    .select()
    .from(unitConversionCache)
    .where(
      and(
        eq(unitConversionCache.displayUnit, normalizedUnit),
        cacheKey
          ? eq(unitConversionCache.ingredientId, cacheKey)
          : isNull(unitConversionCache.ingredientId),
      ),
    )
    .limit(1)

  if (cached.length > 0) {
    return applyFactor(cached[0].gramsPerUnit, cached[0].mlPerUnit, input, 'cache')
  }

  // 3. LLM fallback
  const llm = await client().call({
    displayQuantity: input.displayQuantity,
    displayUnit: input.displayUnit,
    ingredientName: input.ingredient?.name,
  })

  const grams = llm.gramsPerUnit
  const ml = llm.mlPerUnit

  if (grams == null && ml == null) {
    return { canonicalQuantity: 0, canonicalUnit: 'g', source: 'unknown' }
  }

  await db.insert(unitConversionCache).values({
    displayUnit: normalizedUnit,
    ingredientId: cacheKey,
    gramsPerUnit: grams,
    mlPerUnit: ml,
    source: 'llm',
  }).onConflictDoNothing()

  return applyFactor(grams, ml, input, 'llm')
}

function applyFactor(
  gramsPerUnit: number | null,
  mlPerUnit: number | null,
  input: ResolveInput,
  source: 'cache' | 'llm',
): ResolveResult {
  if (mlPerUnit != null) {
    const ml = input.displayQuantity * mlPerUnit
    if (input.ingredient?.density != null) {
      return { canonicalQuantity: round1(ml * input.ingredient.density), canonicalUnit: 'g', source }
    }
    return { canonicalQuantity: round1(ml), canonicalUnit: 'ml', source }
  }
  if (gramsPerUnit != null) {
    return { canonicalQuantity: round1(input.displayQuantity * gramsPerUnit), canonicalUnit: 'g', source }
  }
  return { canonicalQuantity: 0, canonicalUnit: 'g', source: 'unknown' }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
