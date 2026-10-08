/**
 * PRO-02: ingredient names read as a sentence ("Aceite de oliva virgen"),
 * never Title Case ("Aceite De Oliva Virgen"), with accents restored where
 * the catalogue stores them bare. Normalised only for display.
 */
import { describe, it, expect } from 'vitest'
import { ingredientDisplayName } from '@ona/shared'

describe('ingredientDisplayName', () => {
  it('upper-cases only the first letter of a lower-case catalogue name', () => {
    expect(ingredientDisplayName('aceite de oliva virgen')).toBe('Aceite de oliva virgen')
  })

  it('restores accents from the catalogue map', () => {
    expect(ingredientDisplayName('pimenton dulce')).toBe('Pimentón dulce')
    expect(ingredientDisplayName('champinones laminados')).toBe('Champiñones laminados')
  })

  it('keeps brand names and acronyms as written', () => {
    expect(ingredientDisplayName('mantequilla Kerrygold')).toBe('Mantequilla Kerrygold')
    expect(ingredientDisplayName('AOVE')).toBe('AOVE')
    expect(ingredientDisplayName('queso de Burgos')).toBe('Queso de Burgos')
  })

  it('handles empty and padded input', () => {
    expect(ingredientDisplayName('')).toBe('')
    expect(ingredientDisplayName('  sal  ')).toBe('Sal')
  })
})
