/**
 * PRO-1047: the ingredients auto-create saved with another food's USDA entry
 * («pechuga de pollo» = Dulce de Leche), and Mimo's gluten-free agridulce
 * that made the bug visible (Dani y Sara, 2026-10-25).
 */
import { describe, expect, it } from 'vitest'
import { aggregateNutrition, catalogEntryFromRow, type IngredientCatalogEntry } from '../services/nutrition/aggregate.js'
import { fixFor, holdsWrongUsdaEntry, REPAIRS, WRONG_USDA_ENTRIES } from '../services/nutrition/ingredientRepairs.js'
import type { RecipeIngredient, Unit } from '@ona/shared'

type Row = {
  id: string
  name: string
  fdcId: number | null
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  salt: number
  density?: number | null
  unitWeight?: number | null
}

/** The staging catalogue's rows (2026-11-24), per 100 g. */
const ROWS: Row[] = [
  { id: 'pollo', name: 'pollo', fdcId: 171077, calories: 120, protein: 22.5, carbs: 0, fat: 2.62, fiber: 0, salt: 0.1125, unitWeight: 1200 },
  { id: 'pechuga', name: 'pechuga de pollo', fdcId: 173461, calories: 315, protein: 6.84, carbs: 55.35, fat: 7.35, fiber: 0, salt: 0.3225 },
  { id: 'pimiento-rojo', name: 'pimiento rojo', fdcId: 170108, calories: 26, protein: 0.99, carbs: 6.03, fat: 0.3, fiber: 2.1, salt: 0.01 },
  { id: 'pimiento-verde', name: 'pimiento verde', fdcId: 170427, calories: 20, protein: 0.86, carbs: 4.64, fat: 0.17, fiber: 1.7, salt: 0.0075 },
  { id: 'cebolla', name: 'cebolla', fdcId: 170000, calories: 40, protein: 1.1, carbs: 9.34, fat: 0.1, fiber: 1.7, salt: 0.01 },
  { id: 'pina', name: 'piña', fdcId: 2346398, calories: 50, protein: 0.54, carbs: 13.12, fat: 0.12, fiber: 1.4, salt: 0 },
  { id: 'soja', name: 'salsa de soja', fdcId: 174278, calories: 60, protein: 10.51, carbs: 5.57, fat: 0.1, fiber: 0.8, salt: 13.965, density: 1.15 },
  { id: 'tamari', name: 'tamari sin gluten', fdcId: 174278, calories: 60, protein: 10.51, carbs: 5.57, fat: 0.1, fiber: 0.8, salt: 13.965, density: 1.2 },
  { id: 'vinagre', name: 'vinagre de vino', fdcId: 172240, calories: 19, protein: 0.04, carbs: 0.27, fat: 0, fiber: 0, salt: 0.02, density: 1.01 },
  { id: 'azucar', name: 'azúcar', fdcId: null, calories: 385, protein: 0, carbs: 99.6, fat: 0.32, fiber: 0, salt: 0 },
  { id: 'tomate', name: 'tomate triturado', fdcId: 170501, calories: 32, protein: 1.64, carbs: 7.29, fat: 0.28, fiber: 1.9, salt: 0.465 },
  { id: 'ajo', name: 'ajo', fdcId: 169230, calories: 149, protein: 6.36, carbs: 33.06, fat: 0.5, fiber: 2.1, salt: 0.0425 },
  { id: 'jengibre', name: 'jengibre fresco', fdcId: 169231, calories: 80, protein: 1.82, carbs: 17.77, fat: 0.75, fiber: 2, salt: 0.0325, density: 0.4 },
  { id: 'aceite', name: 'aceite de oliva virgen', fdcId: 171413, calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0, salt: 0.005, density: 0.91 },
  { id: 'harina', name: 'harina de trigo', fdcId: 168894, calories: 364, protein: 10.33, carbs: 76.31, fat: 0.98, fiber: 2.7, salt: 0.005 },
  { id: 'maicena', name: 'maicena', fdcId: 169698, calories: 381, protein: 0.26, carbs: 91.27, fat: 0.05, fiber: 0.9, salt: 0.0225 },
]

const byName = new Map(ROWS.map((r) => [r.name.normalize('NFD').replace(/\p{Diacritic}+/gu, '').toLowerCase(), r]))

function catalog(rows: Row[]): Map<string, IngredientCatalogEntry> {
  return new Map(rows.map((r) => [r.id, catalogEntryFromRow(r)]))
}

function lines(list: Array<[string, number, Unit, string?]>): RecipeIngredient[] {
  return list.map(([ingredientId, quantity, unit, note], i) => ({ id: `l${i}`, ingredientId, quantity, unit, note, optional: false, displayOrder: i }))
}

/** The catalogue's «Pollo agridulce»: 500 g of pollo (pechuga) for 4. */
const ORIGINAL = lines([
  ['pollo', 500, 'g', 'pechuga en taquitos'],
  ['pimiento-rojo', 150, 'g'],
  ['pimiento-verde', 150, 'g'],
  ['cebolla', 100, 'g'],
  ['pina', 200, 'g'],
  ['soja', 30, 'ml'],
  ['vinagre', 30, 'ml'],
  ['azucar', 30, 'g'],
  ['tomate', 100, 'g'],
  ['ajo', 8, 'g'],
  ['jengibre', 10, 'g'],
  ['aceite', 30, 'ml'],
  ['harina', 30, 'g', 'para rebozar'],
])

/** Mimo's «Pollo agridulce sin gluten (extra de pollo)»: tamari and maicena, 450 g of pechuga for 2. */
const ADAPTED = lines([
  ['pechuga', 450, 'g'],
  ['pimiento-rojo', 75, 'g'],
  ['pimiento-verde', 75, 'g'],
  ['cebolla', 50, 'g'],
  ['pina', 100, 'g'],
  ['tamari', 15, 'ml'],
  ['vinagre', 15, 'ml'],
  ['azucar', 15, 'g'],
  ['tomate', 50, 'g'],
  ['ajo', 4, 'g'],
  ['jengibre', 5, 'g'],
  ['aceite', 15, 'ml'],
  ['maicena', 20, 'g'],
])

describe('Mimo\'s gluten-free agridulce (PRO-1047)', () => {
  it('with «pechuga de pollo» holding Dulce de Leche, it gave what Dani y Sara saw', () => {
    const r = aggregateNutrition({ servings: 2, ingredients: ADAPTED, catalog: catalog(ROWS) })
    expect(r.perServing.proteinG).toBeLessThan(25) // they saw 20 g
    expect(r.perServing.carbsG).toBeGreaterThan(150) // 165,7 g
    expect(r.perServing.kcal).toBeGreaterThan(900) // 966 kcal
  })

  it('once repaired, it is the original per serving plus its extra 100 g of pechuga', () => {
    const pechuga = ROWS.find((r) => r.id === 'pechuga')!
    expect(holdsWrongUsdaEntry(pechuga)).toBe(true)
    const fixed = { ...pechuga, ...fixFor(pechuga.name, byName) }
    expect(holdsWrongUsdaEntry(fixed)).toBe(false)
    const rows = ROWS.map((r) => (r.id === 'pechuga' ? fixed : r))

    const original = aggregateNutrition({ servings: 4, ingredients: ORIGINAL, catalog: catalog(rows) }).perServing
    const adapted = aggregateNutrition({ servings: 2, ingredients: ADAPTED, catalog: catalog(rows) })
    expect(adapted.incomplete).toBe(false)

    // 225 g of pechuga per serving instead of 125: +100 g × (120 kcal, 22,5 g of protein) per 100 g.
    expect(adapted.perServing.proteinG).toBeCloseTo(original.proteinG + 22.5, -0.5)
    expect(Math.abs(adapted.perServing.kcal - (original.kcal + 120))).toBeLessThan(40)
    // Same sauce: the carbs stay where the original's are (maicena instead of harina).
    expect(Math.abs(adapted.perServing.carbsG - original.carbsG)).toBeLessThan(8)
    expect(adapted.perServing.proteinG).toBeGreaterThan(50)
    expect(adapted.perServing.kcal).toBeLessThan(500)
  })
})

describe('holdsWrongUsdaEntry / fixFor (PRO-1047)', () => {
  it('a row fixed by hand keeps its values, even with the wrong fdcId', () => {
    // «yema de huevo» kept 173461 but its values were curated on 2026-10-17.
    expect(holdsWrongUsdaEntry({ fdcId: 173461, calories: 322, protein: 15.86, carbs: 3.59, fat: 26.54 })).toBe(false)
    // «seitan» really is vital wheat gluten.
    expect(holdsWrongUsdaEntry({ fdcId: 168147, calories: 141, protein: 24.7, carbs: 5.88, fat: 2.35 })).toBe(false)
    expect(holdsWrongUsdaEntry({ fdcId: 171077, calories: 120, protein: 22.5, carbs: 0, fat: 2.62 })).toBe(false)
  })

  it('copies a well-mapped row, takes an estimate, or leaves it with no nutrition', () => {
    expect(fixFor('Pechuga de pollo', byName)).toMatchObject({ fdcId: 171077, calories: 120, protein: 22.5, carbs: 0 })
    expect(fixFor('Corazones de pollo', byName)).toMatchObject({ fdcId: null, calories: 153 })
    // The «from» row is missing here: no nutrition, so its recipes say «incompleta».
    expect(fixFor('Solomillo de pavo', byName)).toEqual({ fdcId: null, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0 })
    expect(fixFor('algo que no está', byName).calories).toBe(0)
  })

  it('every estimate is per 100 g and adds up', () => {
    for (const [name, repair] of Object.entries(REPAIRS)) {
      if (!('estimate' in repair)) continue
      const [kcal, p, c, f, fiber] = repair.estimate
      expect(kcal, name).toBeLessThanOrEqual(900)
      expect(p + c + f, name).toBeLessThanOrEqual(100)
      // Atwater, loosely (fibre at 2 kcal/g); the vanilla extract's kcal are its alcohol.
      if (name === 'extracto de vainilla') continue
      expect(Math.abs(kcal - (4 * p + 4 * (c - fiber) + 2 * fiber + 9 * f)), name).toBeLessThan(0.3 * kcal + 20)
    }
    expect(new Set(WRONG_USDA_ENTRIES.map((e) => e.fdcId)).size).toBe(WRONG_USDA_ENTRIES.length)
  })
})
