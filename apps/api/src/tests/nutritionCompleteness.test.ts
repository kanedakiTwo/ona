import { describe, expect, it } from 'vitest'
import { isNegligibleForNutrition } from '../services/nutrition/negligible.js'
import { recipeNutritionIncomplete } from '../services/nutritionCompleteness.js'
import type { IngredientCatalogEntry } from '../services/nutrition/aggregate.js'

const entry = (id: string, name: string, extra: Partial<IngredientCatalogEntry> = {}): IngredientCatalogEntry => ({
  id, name, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0, density: null, unitWeight: null, ...extra,
})

describe('isNegligibleForNutrition (PRO-176)', () => {
  it('salt, water, spices and herbs are negligible', () => {
    for (const n of ['Sal', 'sal gorda', 'Agua', 'Pimienta negra molida', 'Pimentón de la Vera', 'comino', 'Hojas de laurel', 'Perejil', 'nuez moscada'])
      expect(isNegligibleForNutrition(n), n).toBe(true)
  })
  it('«al gusto» in the note makes any line negligible', () => {
    expect(isNegligibleForNutrition('Queso rallado', 'al gusto')).toBe(true)
  })
  it('food is not', () => {
    for (const n of ['Muslo de pollo', 'Salsa de tomate', 'Salmón', 'Aceite de oliva', 'Pimiento rojo', 'Tortillas de trigo', null])
      expect(isNegligibleForNutrition(n), String(n)).toBe(false)
  })
})

describe('recipeNutritionIncomplete — the mark the boot recompute writes', () => {
  const catalog = new Map([
    ['muslo', entry('muslo', 'Muslo de pollo')],
    ['muslo-pesado', entry('muslo-pesado', 'Contramuslo', { unitWeight: 120 })],
    ['sal', entry('sal', 'Sal')],
  ])
  it('follows the aggregator', () => {
    expect(recipeNutritionIncomplete([{ ingredientId: 'muslo', quantity: 1, unit: 'u', note: null }], catalog)).toBe(true)
    expect(recipeNutritionIncomplete([{ ingredientId: 'muslo-pesado', quantity: 1, unit: 'u', note: null }], catalog)).toBe(false)
    expect(recipeNutritionIncomplete([{ ingredientId: 'sal', quantity: 1, unit: 'u', note: null }], catalog)).toBe(false)
    expect(recipeNutritionIncomplete([], catalog)).toBe(false)
  })
})
