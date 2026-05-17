import { describe, it, expect } from 'vitest'
import { formatFraction, formatCanonical, isCulinaryClean, formatScaled } from '@ona/shared'

describe('formatFraction', () => {
  it.each([
    [1, '1'], [2, '2'], [1.5, '1 1/2'], [0.5, '1/2'],
    [0.25, '1/4'], [1.25, '1 1/4'], [1.33, '1 1/3'], [2.66, '2 2/3'],
    [0.75, '3/4'],
  ])('%f → "%s"', (v, expected) => {
    expect(formatFraction(v)).toBe(expected)
  })
})

describe('formatCanonical', () => {
  it.each([
    [0.5, 'g', '0.5 g'],
    [22, 'ml', '22 ml'],
    [22.7, 'ml', '23 ml'],
    [237, 'g', '235 g'],
    [4.5, 'g', '4.5 g'],
    [1, 'u', '1 u'],
  ])('%f %s → "%s"', (qty, unit, expected) => {
    expect(formatCanonical(qty, unit as 'g' | 'ml' | 'u')).toBe(expected)
  })
})

describe('isCulinaryClean', () => {
  it.each([
    [1, true],
    [2, true],
    [1.5, true],
    [1.33, true],
    [2.75, true],
    [1.47, false],
    [1.18, false],
  ])('%f → clean=%s', (v, expected) => {
    expect(isCulinaryClean(v).clean).toBe(expected)
  })
})

describe('formatScaled', () => {
  it('clean factor keeps display + secondary canonical', () => {
    expect(formatScaled({
      displayQuantity: 1.5, displayUnit: 'cda',
      canonicalQuantity: 22.5, canonicalUnit: 'ml', factor: 1.5,
    })).toEqual({ primary: '1 1/2 cda', secondary: '23 ml' })
  })
  it('rare factor drops display → canonical only', () => {
    expect(formatScaled({
      displayQuantity: 1.47, displayUnit: 'cda',
      canonicalQuantity: 22.05, canonicalUnit: 'ml', factor: 1.47,
    })).toEqual({ primary: '22 ml' })
  })
})
