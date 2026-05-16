import { getTermBySynonym } from './vocabulary.js'

export interface ResolveInput {
  displayQuantity: number
  displayUnit: string
  ingredient?: {
    id?: string
    density?: number | null
    unitWeight?: number | null
    name?: string
  }
}

export interface ResolveResult {
  canonicalQuantity: number
  canonicalUnit: 'g' | 'ml' | 'u'
  source: 'table' | 'cache' | 'llm' | 'unknown'
}

export function resolveFromTable(input: ResolveInput): ResolveResult | null {
  const term = getTermBySynonym(input.displayUnit)
  if (!term) return null
  const { factor } = term
  if (factor.symbolic) {
    return { canonicalQuantity: 0, canonicalUnit: 'g', source: 'table' }
  }
  if (factor.mlPerUnit != null) {
    const ml = input.displayQuantity * factor.mlPerUnit
    if (input.ingredient?.density != null) {
      return { canonicalQuantity: round1(ml * input.ingredient.density), canonicalUnit: 'g', source: 'table' }
    }
    return { canonicalQuantity: round1(ml), canonicalUnit: 'ml', source: 'table' }
  }
  if (factor.perUnitWeight) {
    // If we have a per-ingredient unitWeight, compute grams directly.
    if (input.ingredient?.unitWeight != null) {
      return {
        canonicalQuantity: round1(input.displayQuantity * input.ingredient.unitWeight),
        canonicalUnit: 'g',
        source: 'table',
      }
    }
    // If the term itself ships a default gramsPerUnit (e.g. diente=5, terrón=6),
    // use that.
    if (factor.gramsPerUnit != null) {
      return {
        canonicalQuantity: round1(input.displayQuantity * factor.gramsPerUnit),
        canonicalUnit: 'g',
        source: 'table',
      }
    }
    // Neither — return raw units. The aggregator will resolve grams later via
    // ingredient.unitWeight at nutrition time. This is the `unidad` path:
    // "3 huevos" stored as quantity=3, unit='u'.
    return {
      canonicalQuantity: input.displayQuantity,
      canonicalUnit: 'u',
      source: 'table',
    }
  }
  if (factor.gramsPerUnit != null) {
    return { canonicalQuantity: round1(input.displayQuantity * factor.gramsPerUnit), canonicalUnit: 'g', source: 'table' }
  }
  return null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
