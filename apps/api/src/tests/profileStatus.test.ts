/**
 * «Alergias e intolerancias» on /profile (2026-10-22: a tester couldn't find
 * where to add «intolerancia al pimiento» after the sign-up). The card's
 * one-line status.
 */
import { describe, expect, it } from 'vitest'
import { allergiesStatus } from '../../../web/src/lib/profileStatus'

describe('allergiesStatus', () => {
  it('says what is noted, the first two and how many more', () => {
    expect(allergiesStatus([])).toBe('Ninguna apuntada')
    expect(allergiesStatus(['pimiento'])).toBe('pimiento')
    expect(allergiesStatus(['pimiento', 'gluten'])).toBe('pimiento, gluten')
    expect(allergiesStatus(['pimiento', 'gluten', 'lactosa', 'marisco'])).toBe('pimiento, gluten y 2 más')
  })

  it('loading and failure', () => {
    expect(allergiesStatus(undefined)).toBe('…')
    expect(allergiesStatus(undefined, true)).toBe('Tus alergias')
    expect(allergiesStatus(['', '  '])).toBe('Ninguna apuntada')
  })
})
