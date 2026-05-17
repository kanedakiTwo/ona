import { describe, it, expect } from 'vitest'
import { resolveFromTable } from '@ona/shared'

describe('resolveFromTable — volumetric', () => {
  it('cda without density returns ml', () => {
    expect(resolveFromTable({ displayQuantity: 1, displayUnit: 'cda' })).toEqual({
      canonicalQuantity: 15, canonicalUnit: 'ml', source: 'table',
    })
  })
  it('cda with density converts to grams', () => {
    expect(resolveFromTable({
      displayQuantity: 1, displayUnit: 'cda',
      ingredient: { name: 'aceite', density: 0.92 },
    })).toEqual({ canonicalQuantity: 13.8, canonicalUnit: 'g', source: 'table' })
  })
})

describe('resolveFromTable — mass', () => {
  it('pizca → 0.5g', () => {
    expect(resolveFromTable({ displayQuantity: 1, displayUnit: 'pizca' })).toEqual({
      canonicalQuantity: 0.5, canonicalUnit: 'g', source: 'table',
    })
  })
  it('puñado × 2 → 60g', () => {
    expect(resolveFromTable({ displayQuantity: 2, displayUnit: 'puñado' })).toEqual({
      canonicalQuantity: 60, canonicalUnit: 'g', source: 'table',
    })
  })
})

describe('resolveFromTable — discrete', () => {
  it('uses ingredient.unitWeight when present', () => {
    expect(resolveFromTable({
      displayQuantity: 2, displayUnit: 'diente',
      ingredient: { name: 'ajo', unitWeight: 4 },
    })).toEqual({ canonicalQuantity: 8, canonicalUnit: 'g', source: 'table' })
  })
  it('falls back to term default when unitWeight absent', () => {
    expect(resolveFromTable({
      displayQuantity: 2, displayUnit: 'diente',
      ingredient: { name: 'ajo' },
    })).toEqual({ canonicalQuantity: 10, canonicalUnit: 'g', source: 'table' })
  })
  it('unidad without unitWeight passes through as (qty, "u")', () => {
    expect(resolveFromTable({
      displayQuantity: 3, displayUnit: 'unidad',
      ingredient: { name: 'huevo' },
    })).toEqual({ canonicalQuantity: 3, canonicalUnit: 'u', source: 'table' })
  })
  it('unidad with unitWeight returns grams', () => {
    expect(resolveFromTable({
      displayQuantity: 3, displayUnit: 'u',
      ingredient: { name: 'huevo', unitWeight: 50 },
    })).toEqual({ canonicalQuantity: 150, canonicalUnit: 'g', source: 'table' })
  })
})

describe('resolveFromTable — symbolic', () => {
  it('al gusto → 0g', () => {
    expect(resolveFromTable({ displayQuantity: 1, displayUnit: 'al gusto' })).toEqual({
      canonicalQuantity: 0, canonicalUnit: 'g', source: 'table',
    })
  })
})

describe('resolveFromTable — unknown', () => {
  it('returns null', () => {
    expect(resolveFromTable({ displayQuantity: 1, displayUnit: 'zarandaja' })).toBeNull()
  })
})
