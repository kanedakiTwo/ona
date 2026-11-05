/**
 * PRO-1062: «aceite de sésamo» (and seeds, tahini) tags a recipe with
 * `sesamo` — by name on read, and in the stored tags the boot step fixes.
 */
import { describe, expect, it } from 'vitest'
import { effectiveAllergens, inferAllergenTagsFromName } from '../services/nutrition/allergens.js'
import { missingNameAllergens, recipeNameAllergens } from '../services/nutrition/allergenBackfill.js'

const SESAME_NAMES = [
  'aceite de sésamo',
  'Aceite de sésamo tostado',
  'ACEITE DE SESAMO',
  'semillas de sésamo',
  'sésamo negro',
  'pasta de sésamo',
  'tahini',
  'tahina',
]

describe('sesame by name (PRO-1062)', () => {
  it('every name with «sésamo», tahini or tahina is `sesamo`', () => {
    for (const name of SESAME_NAMES) expect(inferAllergenTagsFromName(name), name).toContain('sesamo')
  })

  it('a noodle recipe with «aceite de sésamo» shows `sesamo` even if its stored union lacks it', () => {
    const names = ['Fideos de arroz', 'Aceite de sésamo', 'Salsa de soja', 'Cebolleta']
    expect(effectiveAllergens(['gluten', 'soja'], names)).toEqual(['gluten', 'sesamo', 'soja'])
  })

  it('the boot step adds `sesamo` to an ingredient that lacks it, never removes', () => {
    expect(missingNameAllergens('aceite de sésamo', [])).toEqual(['sesamo'])
    expect(missingNameAllergens('Semillas de sésamo', null)).toEqual(['sesamo'])
    expect(missingNameAllergens('tahini', ['frutos_secos'])).toEqual(['sesamo'])
    expect(missingNameAllergens('aceite de sésamo', ['sesamo'])).toEqual([])
    expect(missingNameAllergens('aceite de oliva', [])).toEqual([])
  })

  it('recipes using a sesame ingredient must carry `sesamo`, even when the ingredient already had it', () => {
    expect(recipeNameAllergens('aceite de sésamo', [])).toEqual(['sesamo'])
    expect(recipeNameAllergens('caldo de ave', ['apio'])).toEqual(['apio'])
    expect(recipeNameAllergens('aceite de oliva', [])).toEqual([])
  })
})
