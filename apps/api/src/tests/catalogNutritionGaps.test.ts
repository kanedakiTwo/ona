import { describe, it, expect } from 'vitest'
import { nutritionDataGaps, type NutritionGapLine } from '../services/catalogNutritionGaps.js'

const line = (o: Partial<NutritionGapLine> & { recipe: string; ingredient: string; unit: string }): NutritionGapLine => ({
  calories: 100,
  unitWeight: null,
  density: null,
  ...o,
})

describe('nutritionDataGaps', () => {
  it('flags 0 kcal, a unit line with no unit weight and a ml line with no density', () => {
    const gaps = nutritionDataGaps([
      line({ recipe: 'Fabada', ingredient: 'chorizo oreado', unit: 'g', calories: 0 }),
      line({ recipe: 'Lentejas con chorizo', ingredient: 'chorizo oreado', unit: 'g', calories: 0 }),
      line({ recipe: 'Fabada', ingredient: 'dientes de ajo', unit: 'u' }),
      line({ recipe: 'Croquetas', ingredient: 'leche', unit: 'ml' }),
    ])
    expect(gaps).toEqual([
      { ingredient: 'chorizo oreado', kinds: ['sin_kcal'], recipes: ['Fabada', 'Lentejas con chorizo'] },
      { ingredient: 'dientes de ajo', kinds: ['sin_peso_por_unidad'], recipes: ['Fabada'] },
      { ingredient: 'leche', kinds: ['sin_densidad'], recipes: ['Croquetas'] },
    ])
  })

  it('ignores agua and sal, «al gusto» and «pizca» lines, and complete data', () => {
    expect(
      nutritionDataGaps([
        line({ recipe: 'Fabada', ingredient: 'agua', unit: 'ml', calories: 0 }),
        line({ recipe: 'Fabada', ingredient: 'sal', unit: 'g', calories: 0 }),
        line({ recipe: 'Fabada', ingredient: 'pimienta negra', unit: 'pizca', calories: 0 }),
        line({ recipe: 'Fabada', ingredient: 'perejil', unit: 'al_gusto', calories: 0 }),
        line({ recipe: 'Fabada', ingredient: 'huevo', unit: 'u', unitWeight: 50 }),
        line({ recipe: 'Fabada', ingredient: 'aceite de oliva virgen', unit: 'ml', density: 0.91 }),
      ]),
    ).toEqual([])
  })
})
