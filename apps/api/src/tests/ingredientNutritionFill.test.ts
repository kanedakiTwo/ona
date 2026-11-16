/**
 * PRO-1125 (2): reading the JSON the night agent writes for
 * `scripts/ingredientNutrition.ts`. Applying it and the recompute are in
 * ingredientNutritionRecompute.smoke.ts (real Postgres).
 */
import { describe, expect, it } from 'vitest'
import { parseNutritionFile, sourceKind } from '../services/nutrition/ingredientNutritionFill.js'

const v = { kcal: 232, 'proteína': 23.2, hidratos: 0, grasa: 14.8, fibra: 0, sal: 0.2 }

describe('parseNutritionFile', () => {
  it('reads {nombre: {kcal, proteína, hidratos, grasa, fibra, sal, fuente}}, with or without accents', () => {
    const { entries, errors } = parseNutritionFile({
      'manitas de cerdo': { ...v, fuente: 'BEDCA 0123' },
      ' mascarpone ': { kcal: 429, proteina: 4.8, hidratos: 4.8, grasa: 44, fibra: 0, sal: 0.1, fuente: 'USDA SR Legacy 1074' },
      'masa de hojaldre': { ...v, Fuente: 'Estimación (Cocina)' },
    })
    expect(errors).toEqual([])
    expect(entries).toEqual([
      { name: 'manitas de cerdo', kcal: 232, proteinG: 23.2, carbsG: 0, fatG: 14.8, fiberG: 0, saltG: 0.2, source: 'BEDCA 0123', sourceKind: 'BEDCA', fdcId: null },
      { name: 'mascarpone', kcal: 429, proteinG: 4.8, carbsG: 4.8, fatG: 44, fiberG: 0, saltG: 0.1, source: 'USDA SR Legacy 1074', sourceKind: 'USDA', fdcId: 1074 },
      { name: 'masa de hojaldre', kcal: 232, proteinG: 23.2, carbsG: 0, fatG: 14.8, fiberG: 0, saltG: 0.2, source: 'Estimación (Cocina)', sourceKind: 'estimación', fdcId: null },
    ])
  })

  it('every bad entry is an error line; the good ones still apply', () => {
    const { entries, errors } = parseNutritionFile({
      bien: { ...v, fuente: 'BEDCA' },
      'sin fuente': { ...v },
      'fuente rara': { ...v, fuente: 'la web' },
      'un plato de encuesta': { ...v, fuente: 'USDA Survey (FNDDS) 2345678' },
      'fuera de rango': { ...v, kcal: 1200, fuente: 'BEDCA' },
      'pasa de 100 g': { ...v, 'proteína': 60, hidratos: 50, fuente: 'estimación' },
      'no es un objeto': 7,
    })
    expect(entries.map((e) => e.name)).toEqual(['bien'])
    expect(errors).toHaveLength(6)
    expect(errors.find((e) => e.startsWith('«fuente rara»'))).toMatch(/BEDCA, USDA/)
    expect(errors.find((e) => e.startsWith('«pasa de 100 g»'))).toMatch(/100 g/)
  })

  it('a file that is not an object is one error', () => {
    expect(parseNutritionFile([1, 2]).errors).toHaveLength(1)
    expect(parseNutritionFile(null).entries).toEqual([])
  })
})

describe('sourceKind', () => {
  it('BEDCA, USDA (with its id when given) or an estimate; FNDDS is never a source', () => {
    expect(sourceKind('BEDCA')).toEqual({ kind: 'BEDCA', fdcId: null })
    expect(sourceKind('USDA Foundation 2646170')).toEqual({ kind: 'USDA', fdcId: 2646170 })
    expect(sourceKind('usda sr legacy')).toEqual({ kind: 'USDA', fdcId: null })
    expect(sourceKind('estimacion')).toEqual({ kind: 'estimación', fdcId: null })
    expect(sourceKind('USDA FNDDS 2345678')).toBeNull()
    expect(sourceKind('Wikipedia')).toBeNull()
  })
})
