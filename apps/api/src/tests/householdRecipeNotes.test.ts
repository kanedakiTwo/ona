import { describe, it, expect } from 'vitest'
import { cleanNote, householdNoteInline, householdNoteLines } from '../services/assistant/householdRecipeNotes.js'

// PRO-1071: what Mimo reads of the household's note on a recipe.
describe('household recipe notes for Mimo (PRO-1071)', () => {
  it('keeps the words and reads a repeated line once (Carmen\'s comino, saved twice)', () => {
    expect(cleanNote('Una pizca de comino al final.\nUna pizca de comino al final.')).toBe('Una pizca de comino al final.')
    expect(cleanNote('Con pescadilla también sale muy rica.\r\n\nMejor sin sal.')).toBe('Con pescadilla también sale muy rica. / Mejor sin sal.')
    expect(cleanNote('  \n ')).toBeNull()
    expect(cleanNote(null)).toBeNull()
  })

  it('says the note and substitutions, or that there is none', () => {
    expect(householdNoteLines({ notes: 'Una pizca de comino al final.', substitutions: null })).toEqual([
      'Nota del hogar en esta receta (citala tal cual, entre comillas): «Una pizca de comino al final.»',
    ])
    expect(householdNoteLines(null)).toEqual(['Nota del hogar en esta receta: ninguna.'])
    expect(householdNoteInline({ notes: null, substitutions: 'Vale la pescadilla.' })).toBe('sustituciones del hogar: «Vale la pescadilla.»')
    expect(householdNoteInline(undefined)).toBe('')
  })
})
