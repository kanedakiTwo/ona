/**
 * PRO-184 — «6 dientes» in an ingredient's note scales with the servings.
 */
import { describe, expect, it } from 'vitest'
import { formatHalves, noteStartsWithCount, noteStartsWithNumber, scaleIngredientNote } from '@ona/shared'
import { scaleRecipe } from '../services/recipeScaler.js'
import { lintRecipe } from '../services/recipeLint.js'

describe('scaleIngredientNote', () => {
  it('«6 dientes, laminados» for 4 → «1½ dientes, laminados» for 1', () => {
    expect(scaleIngredientNote('6 dientes, laminados', 1 / 4)).toBe('1½ dientes, laminados')
  })

  it('rounds to halves, never below ½, and picks singular/plural', () => {
    expect(scaleIngredientNote('2 hojas', 1 / 4)).toBe('½ hoja')
    expect(scaleIngredientNote('1 rama', 2)).toBe('2 ramas')
    expect(scaleIngredientNote('4 dientes', 1 / 4)).toBe('1 diente')
    expect(scaleIngredientNote('3 dientes picados', 1 / 2)).toBe('1½ dientes picados')
    expect(scaleIngredientNote('½ guindilla', 4)).toBe('2 guindillas')
    expect(scaleIngredientNote('1,5 hojas', 2)).toBe('3 hojas')
    expect(formatHalves(0.1)).toBe('½')
    expect(formatHalves(2.74)).toBe('2½')
  })

  it('leaves notes without a countable amount as they are', () => {
    expect(scaleIngredientNote('laminados', 1 / 4)).toBe('laminados')
    expect(scaleIngredientNote('200 g de lomo', 1 / 4)).toBe('200 g de lomo')
    expect(scaleIngredientNote('2 latas', 1 / 2)).toBe('2 latas')
    expect(scaleIngredientNote('6 dientes', 1)).toBe('6 dientes')
    expect(scaleIngredientNote(null, 2)).toBeNull()
    expect(noteStartsWithCount('6 dientes')).toBe(true)
    expect(noteStartsWithCount('laminados')).toBe(false)
    expect(noteStartsWithNumber('200 g de lomo')).toBe(true)
    expect(noteStartsWithNumber('en lomos')).toBe(false)
  })
})

describe('scaleRecipe scales the note with the quantity', () => {
  const recipe = {
    id: 'r', name: 'Espaguetis con ajo y aceite', servings: 4,
    ingredients: [
      { id: 'a', ingredientId: 'i-ajo', ingredientName: 'Ajo', quantity: 24, unit: 'g', note: '6 dientes, laminados' },
      { id: 'b', ingredientId: 'i-esp', ingredientName: 'Espaguetis', quantity: 320, unit: 'g', note: 'laminados' },
    ],
    steps: [],
  } as any

  it('for 1 serving: «1½ dientes, laminados», 6 g', () => {
    const out = scaleRecipe(recipe, 1)
    expect(out.ingredients[0].note).toBe('1½ dientes, laminados')
    expect(out.ingredients[0].quantity).toBe(6)
    expect(out.ingredients[1].note).toBe('laminados')
  })

  it('at its own servings nothing changes', () => {
    expect(scaleRecipe(recipe, 4).ingredients[0].note).toBe('6 dientes, laminados')
  })
})

describe('the linter warns about a note that starts with a number', () => {
  it('NOTE_STARTS_WITH_NUMBER on «6 dientes, laminados», not on «laminados»', () => {
    const catalog = { byId: new Map([['i-ajo', { id: 'i-ajo', name: 'ajo' }]]), all: [{ id: 'i-ajo', name: 'ajo' }] }
    const base = {
      name: 'Ajo', servings: 4, meals: ['lunch'], seasons: ['spring'], equipment: ['sartén'],
      steps: [{ index: 0, text: 'Laminar el ajo.' }],
    }
    const lint = (note: string) =>
      lintRecipe({ ...base, ingredients: [{ ingredientId: 'i-ajo', quantity: 24, unit: 'g', note }] } as any, { catalog } as any)
    expect(lint('6 dientes, laminados').warnings.map((w) => w.code)).toContain('NOTE_STARTS_WITH_NUMBER')
    expect(lint('laminados').warnings.map((w) => w.code)).not.toContain('NOTE_STARTS_WITH_NUMBER')
  })
})
