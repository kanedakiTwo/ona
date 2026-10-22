/**
 * Unit tests for the per-recipe nutrition aggregator.
 *
 * Run: pnpm --filter @ona/api test
 *  or: cd apps/api && npx vitest run src/tests/nutritionAggregate.test.ts
 */

import { describe, it, expect } from 'vitest'
import type { RecipeIngredient, Unit } from '@ona/shared'
import {
  aggregateNutrition,
  edibleShare,
  lineEdibleShare,
  type IngredientCatalogEntry,
} from '../services/nutrition/aggregate.js'

// ─── Fixtures ───────────────────────────────────────────────────

let rowCounter = 0
function makeIngredient(
  overrides: Partial<RecipeIngredient> & {
    quantity: number
    unit: Unit
    ingredientId: string
  },
): RecipeIngredient {
  rowCounter += 1
  return {
    id: overrides.id ?? `row-${rowCounter}`,
    ingredientId: overrides.ingredientId,
    quantity: overrides.quantity,
    unit: overrides.unit,
    optional: false,
    displayOrder: 0,
    ...overrides,
  }
}

function makeEntry(
  overrides: Partial<IngredientCatalogEntry> & { id: string; name: string },
): IngredientCatalogEntry {
  return {
    id: overrides.id,
    name: overrides.name,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    salt: 0,
    density: null,
    unitWeight: null,
    ...overrides,
  }
}

function catalogOf(entries: IngredientCatalogEntry[]): Map<string, IngredientCatalogEntry> {
  const m = new Map<string, IngredientCatalogEntry>()
  for (const e of entries) m.set(e.id, e)
  return m
}

// ─── Happy path ────────────────────────────────────────────────

describe('aggregateNutrition — happy path', () => {
  it('computes per-serving values within ±2 % of a hand-computed reference (3 g-quantified ingredients)', () => {
    // Recipe: 4 servings.
    // 400 g chicken breast (165 kcal, 31 P, 0 C, 3.6 F, 0 fib, 0.18 salt /100 g)
    // 200 g rice (130 kcal, 2.7 P, 28 C, 0.3 F, 0.4 fib, 0 salt /100 g)
    // 50 g olive oil (884 kcal, 0 P, 0 C, 100 F, 0 fib, 0.02 salt /100 g)
    // Totals: kcal = 660 + 260 + 442 = 1362 → /4 = 340.5 → round → 341
    //   protein = 124 + 5.4 + 0 = 129.4 / 4 = 32.35 → 32.4
    //   carbs = 0 + 56 + 0 = 56 / 4 = 14
    //   fat = 14.4 + 0.6 + 50 = 65 / 4 = 16.25 → 16.3 (Math.round(162.5/10) banker / half-up varies)
    //   fiber = 0 + 0.8 + 0 = 0.8 / 4 = 0.2
    //   salt = 0.72 + 0 + 0.01 = 0.73 / 4 = 0.1825 → 0.2
    const catalog = catalogOf([
      makeEntry({
        id: 'chicken',
        name: 'pollo',
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
        fiber: 0,
        salt: 0.18,
      }),
      makeEntry({
        id: 'rice',
        name: 'arroz',
        calories: 130,
        protein: 2.7,
        carbs: 28,
        fat: 0.3,
        fiber: 0.4,
        salt: 0,
      }),
      makeEntry({
        id: 'oil',
        name: 'aceite oliva',
        calories: 884,
        protein: 0,
        carbs: 0,
        fat: 100,
        fiber: 0,
        salt: 0.02,
      }),
    ])

    const result = aggregateNutrition({
      servings: 4,
      ingredients: [
        makeIngredient({ ingredientId: 'chicken', quantity: 400, unit: 'g' }),
        makeIngredient({ ingredientId: 'rice', quantity: 200, unit: 'g' }),
        makeIngredient({ ingredientId: 'oil', quantity: 50, unit: 'g' }),
      ],
      catalog,
    })

    expect(result.skipped).toEqual([])
    // kcal: integer; ±2 % bound around 341
    expect(result.perServing.kcal).toBeGreaterThanOrEqual(Math.round(341 * 0.98))
    expect(result.perServing.kcal).toBeLessThanOrEqual(Math.round(341 * 1.02))
    expect(result.perServing.proteinG).toBeCloseTo(32.4, 1)
    expect(result.perServing.carbsG).toBeCloseTo(14, 1)
    expect(result.perServing.fatG).toBeCloseTo(16.3, 1)
    expect(result.perServing.fiberG).toBeCloseTo(0.2, 1)
    expect(result.perServing.saltG).toBeCloseTo(0.2, 1)
  })
})

// ─── Unit conversions ──────────────────────────────────────────

describe('aggregateNutrition — ml conversion via density', () => {
  it('uses density (g/ml) to convert ml → g (milk @ 1.03 g/ml)', () => {
    // 250 ml leche × 1.03 = 257.5 g
    // Per 100g: 42 kcal, 3.4 P, 5 C, 1 F, 0 fib, 0.1 salt
    // Totals: 257.5/100 = 2.575
    //   kcal = 108.15 → /1 serving → 108
    //   protein = 8.755 → 8.8
    //   carbs = 12.875 → 12.9
    //   fat = 2.575 → 2.6 (rounding may go 2.6 or 2.5; Math.round(25.75)=26 → 2.6)
    //   fiber = 0
    //   salt = 0.2575 → 0.3
    const catalog = catalogOf([
      makeEntry({
        id: 'milk',
        name: 'leche',
        calories: 42,
        protein: 3.4,
        carbs: 5,
        fat: 1,
        fiber: 0,
        salt: 0.1,
        density: 1.03,
      }),
    ])
    const result = aggregateNutrition({
      servings: 1,
      ingredients: [makeIngredient({ ingredientId: 'milk', quantity: 250, unit: 'ml' })],
      catalog,
    })

    expect(result.skipped).toEqual([])
    expect(result.perServing.kcal).toBe(108)
    expect(result.perServing.proteinG).toBeCloseTo(8.8, 1)
    expect(result.perServing.carbsG).toBeCloseTo(12.9, 1)
    expect(result.perServing.fatG).toBeCloseTo(2.6, 1)
    expect(result.perServing.saltG).toBeCloseTo(0.3, 1)
  })
})

describe('aggregateNutrition — u conversion via unitWeight', () => {
  it('multiplies by unitWeight (huevo 50 g)', () => {
    // 2 huevos × 50 g = 100 g
    // Per 100g: 155 kcal, 13 P, 1.1 C, 11 F, 0 fib, 0.36 salt
    // /1 serving → kcal=155, protein=13, carbs=1.1, fat=11, salt=0.4
    const catalog = catalogOf([
      makeEntry({
        id: 'egg',
        name: 'huevo',
        calories: 155,
        protein: 13,
        carbs: 1.1,
        fat: 11,
        fiber: 0,
        salt: 0.36,
        unitWeight: 50,
      }),
    ])
    const result = aggregateNutrition({
      servings: 1,
      ingredients: [makeIngredient({ ingredientId: 'egg', quantity: 2, unit: 'u' })],
      catalog,
    })

    expect(result.skipped).toEqual([])
    expect(result.perServing.kcal).toBe(155)
    expect(result.perServing.proteinG).toBeCloseTo(13, 1)
    expect(result.perServing.carbsG).toBeCloseTo(1.1, 1)
    expect(result.perServing.fatG).toBeCloseTo(11, 1)
    expect(result.perServing.saltG).toBeCloseTo(0.4, 1)
  })
})

describe('aggregateNutrition — cda / cdita', () => {
  it('uses density when present (1 cda olive oil @ 0.92 g/ml = 13.8 g)', () => {
    // 1 cda × 15 ml × 0.92 g/ml = 13.8 g of oil; oil = 884 kcal/100g
    // kcal = 884 * 0.138 = 121.99 → 122
    // fat = 100 * 0.138 = 13.8
    const catalog = catalogOf([
      makeEntry({
        id: 'oil',
        name: 'aceite oliva',
        calories: 884,
        protein: 0,
        carbs: 0,
        fat: 100,
        fiber: 0,
        salt: 0,
        density: 0.92,
      }),
    ])
    const result = aggregateNutrition({
      servings: 1,
      ingredients: [makeIngredient({ ingredientId: 'oil', quantity: 1, unit: 'cda' })],
      catalog,
    })
    expect(result.skipped).toEqual([])
    expect(result.perServing.kcal).toBe(122)
    expect(result.perServing.fatG).toBeCloseTo(13.8, 1)
  })

  it('defaults to 1 g/ml when density is missing (cda → 15 g, cdita → 5 g)', () => {
    // Per 100g: 100 kcal, 1 P, 1 C, 1 F, 0 fib, 0 salt
    // 1 cda → 15 g → 15 kcal; 1 cdita → 5 g → 5 kcal; 1 serving → 20 kcal
    const catalog = catalogOf([
      makeEntry({
        id: 'spice',
        name: 'especia',
        calories: 100,
        protein: 1,
        carbs: 1,
        fat: 1,
        fiber: 0,
        salt: 0,
      }),
    ])
    const result = aggregateNutrition({
      servings: 1,
      ingredients: [
        makeIngredient({ id: 'r1', ingredientId: 'spice', quantity: 1, unit: 'cda' }),
        makeIngredient({ id: 'r2', ingredientId: 'spice', quantity: 1, unit: 'cdita' }),
      ],
      catalog,
    })
    expect(result.skipped).toEqual([])
    // 15 + 5 = 20 g of spice → 20% of per-100 row
    expect(result.perServing.kcal).toBe(20)
    expect(result.perServing.proteinG).toBeCloseTo(0.2, 1)
  })
})

describe('aggregateNutrition — pizca / al_gusto', () => {
  it('contributes 0 g (negligible)', () => {
    const catalog = catalogOf([
      makeEntry({
        id: 'salt',
        name: 'sal',
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        salt: 100,
      }),
    ])
    const result = aggregateNutrition({
      servings: 1,
      ingredients: [
        makeIngredient({ id: 'r1', ingredientId: 'salt', quantity: 1, unit: 'pizca' }),
        makeIngredient({ id: 'r2', ingredientId: 'salt', quantity: 1, unit: 'al_gusto' }),
      ],
      catalog,
    })
    expect(result.skipped).toEqual([])
    expect(result.perServing).toEqual({
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      saltG: 0,
    })
  })
})

// ─── Optional & inclusion rules ────────────────────────────────

describe('aggregateNutrition — optional ingredients', () => {
  it('includes optional rows in the per-serving total', () => {
    // 100 g base + 100 g optional → both count.
    const catalog = catalogOf([
      makeEntry({ id: 'a', name: 'a', calories: 100 }),
      makeEntry({ id: 'b', name: 'b', calories: 100 }),
    ])
    const result = aggregateNutrition({
      servings: 1,
      ingredients: [
        makeIngredient({ id: 'r1', ingredientId: 'a', quantity: 100, unit: 'g' }),
        makeIngredient({
          id: 'r2',
          ingredientId: 'b',
          quantity: 100,
          unit: 'g',
          optional: true,
        }),
      ],
      catalog,
    })
    expect(result.skipped).toEqual([])
    expect(result.perServing.kcal).toBe(200)
  })
})

// ─── Skipping behaviour ─────────────────────────────────────────

describe('aggregateNutrition — unmapped ingredient', () => {
  it('skips with `unmapped` reason and continues with the rest', () => {
    const catalog = catalogOf([
      makeEntry({ id: 'a', name: 'a', calories: 100 }),
    ])
    const result = aggregateNutrition({
      servings: 1,
      ingredients: [
        makeIngredient({ id: 'r1', ingredientId: 'a', quantity: 100, unit: 'g' }),
        makeIngredient({ id: 'r2', ingredientId: 'missing', quantity: 100, unit: 'g' }),
      ],
      catalog,
    })
    expect(result.skipped).toEqual([{ ingredientId: 'missing', reason: 'unmapped' }])
    expect(result.perServing.kcal).toBe(100)
  })
})

describe('aggregateNutrition — ml without density', () => {
  it('skips with `no-density` reason', () => {
    const catalog = catalogOf([
      makeEntry({ id: 'liquid', name: 'liquid', calories: 50 }),
    ])
    const result = aggregateNutrition({
      servings: 1,
      ingredients: [makeIngredient({ ingredientId: 'liquid', quantity: 100, unit: 'ml' })],
      catalog,
    })
    expect(result.skipped).toEqual([
      { ingredientId: 'liquid', reason: 'no-density' },
    ])
    expect(result.perServing.kcal).toBe(0)
  })
})

describe('aggregateNutrition — u without unitWeight', () => {
  it('skips with `no-unit-weight` reason', () => {
    const catalog = catalogOf([
      makeEntry({ id: 'thing', name: 'thing', calories: 50 }),
    ])
    const result = aggregateNutrition({
      servings: 1,
      ingredients: [makeIngredient({ ingredientId: 'thing', quantity: 2, unit: 'u' })],
      catalog,
    })
    expect(result.skipped).toEqual([
      { ingredientId: 'thing', reason: 'no-unit-weight' },
    ])
    expect(result.perServing.kcal).toBe(0)
  })
})

describe('aggregateNutrition — unsupported unit (defensive)', () => {
  it('skips with `unsupported-unit` when handed a unit not in the schema', () => {
    const catalog = catalogOf([
      makeEntry({ id: 'a', name: 'a', calories: 100 }),
    ])
    // Bypass the type system to simulate broken/legacy data.
    const bogus = makeIngredient({ ingredientId: 'a', quantity: 1, unit: 'g' })
    ;(bogus as { unit: string }).unit = 'tazas'
    const result = aggregateNutrition({
      servings: 1,
      ingredients: [bogus as RecipeIngredient & { quantity: number }],
      catalog,
    })
    expect(result.skipped).toEqual([{ ingredientId: 'a', reason: 'unsupported-unit' }])
    expect(result.perServing.kcal).toBe(0)
  })
})

// ─── Edge cases ────────────────────────────────────────────────

describe('aggregateNutrition — empty ingredients', () => {
  it('returns all-zero per-serving with no skips', () => {
    const result = aggregateNutrition({
      servings: 4,
      ingredients: [],
      catalog: new Map(),
    })
    expect(result.skipped).toEqual([])
    expect(result.perServing).toEqual({
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      saltG: 0,
    })
  })
})

describe('aggregateNutrition — invalid servings', () => {
  it('throws when servings is 0', () => {
    expect(() =>
      aggregateNutrition({ servings: 0, ingredients: [], catalog: new Map() }),
    ).toThrow(/servings/)
  })

  it('throws when servings is negative', () => {
    expect(() =>
      aggregateNutrition({ servings: -2, ingredients: [], catalog: new Map() }),
    ).toThrow(/servings/)
  })

  it('throws when servings is NaN', () => {
    expect(() =>
      aggregateNutrition({ servings: NaN, ingredients: [], catalog: new Map() }),
    ).toThrow(/servings/)
  })
})

// ─── Performance ───────────────────────────────────────────────

describe('aggregateNutrition — performance', () => {
  it('aggregates a 30-ingredient recipe in well under 5 ms', () => {
    const entries: IngredientCatalogEntry[] = Array.from({ length: 30 }, (_, i) =>
      makeEntry({
        id: `ing-${i}`,
        name: `i-${i}`,
        calories: 100 + i,
        protein: 5,
        carbs: 10,
        fat: 3,
        fiber: 1,
        salt: 0.1,
        density: 1.0,
        unitWeight: 50,
      }),
    )
    const catalog = catalogOf(entries)
    const ingredients = entries.map((e, i) =>
      makeIngredient({
        id: `row-${i}`,
        ingredientId: e.id,
        quantity: 50 + i * 3,
        unit: (['g', 'ml', 'u', 'cda', 'cdita'] as Unit[])[i % 5],
      }),
    )

    const t0 = performance.now()
    const result = aggregateNutrition({ servings: 4, ingredients, catalog })
    const elapsed = performance.now() - t0

    expect(result.skipped).toEqual([])
    expect(elapsed).toBeLessThan(5)
  })
})

// ─── Frying / confit fat (cookingMedium) ────────────────────────

describe('aggregateNutrition — frying and confit fat', () => {
  const aceite = makeEntry({ id: 'ing-aceite', name: 'aceite de girasol', calories: 884, fat: 100, density: 0.92 })
  const pimientos = makeEntry({ id: 'ing-pimiento', name: 'pimientos de padrón', calories: 20, carbs: 3 })
  const catalog = catalogOf([aceite, pimientos])
  // 500 ml × 0.92 g/ml = 460 g of oil → 4066.4 kcal if all of it were eaten.
  const kcalOf = (note?: string) =>
    aggregateNutrition({
      servings: 1,
      ingredients: [makeIngredient({ ingredientId: 'ing-aceite', quantity: 500, unit: 'ml', note })],
      catalog,
    }).perServing.kcal

  it('counts only the absorbed 15 % of oil noted «para freír»', () => {
    expect(kcalOf('para freír; se recupera casi todo')).toBe(Math.round(4066.4 * 0.15))
  })

  it('is accent- and case-insensitive and accepts «para freírlos» / «para la fritura»', () => {
    const expected = Math.round(4066.4 * 0.15)
    expect(kcalOf('Para freir')).toBe(expected)
    expect(kcalOf('para freírlos')).toBe(expected)
    expect(kcalOf('para la fritura')).toBe(expected)
  })

  it('counts 25 % of fat noted «para confitar»', () => {
    expect(kcalOf('para confitar; se recupera casi todo')).toBe(Math.round(4066.4 * 0.25))
  })

  it('counts all of it without the note, or when the note only mentions frying later', () => {
    expect(kcalOf()).toBe(4066)
    expect(kcalOf('40 ml para el pisto y el resto para freír')).toBe(4066)
  })

  it('never reduces a non-fat ingredient, whatever its note says', () => {
    const { perServing } = aggregateNutrition({
      servings: 1,
      ingredients: [makeIngredient({ ingredientId: 'ing-pimiento', quantity: 200, unit: 'g', note: 'para freír' })],
      catalog,
    })
    expect(perServing.kcal).toBe(40)
  })
})

// ─── PRO-176: «nutrición incompleta» ───────────────────────────

describe('aggregateNutrition — incomplete mark (PRO-176)', () => {
  const muslo = makeEntry({ id: 'muslo', name: 'Muslo de pollo', calories: 177, protein: 18, fat: 11.6, unitWeight: null })
  const arroz = makeEntry({ id: 'arroz', name: 'Arroz', calories: 360, protein: 7, carbs: 79 })
  const sal = makeEntry({ id: 'sal', name: 'Sal', salt: 100, unitWeight: null })
  const pimienta = makeEntry({ id: 'pimienta', name: 'Pimienta negra molida', density: null })
  const caldo = makeEntry({ id: 'caldo', name: 'Caldo de pollo', calories: 5, density: null })
  const catalog = catalogOf([muslo, arroz, sal, pimienta, caldo])

  it('«1 ud» de muslo without a weight per unit makes the recipe incomplete', () => {
    const r = aggregateNutrition({
      servings: 2,
      ingredients: [
        makeIngredient({ ingredientId: 'arroz', quantity: 200, unit: 'g' }),
        makeIngredient({ ingredientId: 'muslo', quantity: 1, unit: 'u' }),
      ] as any,
      catalog,
    })
    expect(r.skipped).toEqual([{ ingredientId: 'muslo', reason: 'no-unit-weight' }])
    expect(r.incomplete).toBe(true)
  })

  it('salt «al gusto» (or by units), spices and a note «al gusto» do not', () => {
    const r = aggregateNutrition({
      servings: 2,
      ingredients: [
        makeIngredient({ ingredientId: 'arroz', quantity: 200, unit: 'g' }),
        makeIngredient({ ingredientId: 'sal', quantity: 0, unit: 'al_gusto' }),
        makeIngredient({ ingredientId: 'sal', quantity: 1, unit: 'u' }),
        makeIngredient({ ingredientId: 'pimienta', quantity: 2, unit: 'ml' }),
        makeIngredient({ ingredientId: 'caldo', quantity: 1, unit: 'ml', note: 'al gusto' }),
      ] as any,
      catalog,
    })
    expect(r.skipped.length).toBe(3)
    expect(r.incomplete).toBe(false)
  })

  it('an ml line without density or a missing catalogue row also counts', () => {
    const noDensity = aggregateNutrition({
      servings: 2,
      ingredients: [makeIngredient({ ingredientId: 'caldo', quantity: 500, unit: 'ml' })] as any,
      catalog,
    })
    expect(noDensity.incomplete).toBe(true)
    const unmapped = aggregateNutrition({
      servings: 2,
      ingredients: [makeIngredient({ ingredientId: 'nope', quantity: 100, unit: 'g' })] as any,
      catalog,
    })
    expect(unmapped.incomplete).toBe(true)
  })

  it('a recipe with nothing skipped is complete', () => {
    const r = aggregateNutrition({
      servings: 2,
      ingredients: [makeIngredient({ ingredientId: 'arroz', quantity: 200, unit: 'g' })] as any,
      catalog,
    })
    expect(r.incomplete).toBe(false)
    expect(aggregateNutrition({ servings: 2, ingredients: [], catalog }).incomplete).toBe(false)
  })
})

// ─── PRO-194: edible weight of bone-in cuts ────────────────────

describe('aggregateNutrition — edible fraction (PRO-194)', () => {
  it('counts only the edible part of a bone-in cut, in grams and by units', () => {
    const gallina = makeEntry({ id: 'gallina', name: 'gallina', calories: 200, protein: 20, edibleFraction: 0.7 })
    const manitas = makeEntry({ id: 'manitas', name: 'manitas de cerdo', calories: 212, protein: 23, unitWeight: 300, edibleFraction: 0.5 })
    const catalog = catalogOf([gallina, manitas])
    const g = aggregateNutrition({
      servings: 6,
      ingredients: [makeIngredient({ ingredientId: 'gallina', quantity: 1350, unit: 'g' })] as any,
      catalog,
    })
    // 1350 g × 0.7 = 945 g eaten → 189 g protein / 6
    expect(g.perServing.proteinG).toBeCloseTo(31.5, 1)
    expect(g.perServing.kcal).toBe(315)
    const m = aggregateNutrition({
      servings: 4,
      ingredients: [makeIngredient({ ingredientId: 'manitas', quantity: 5, unit: 'u' })] as any,
      catalog,
    })
    // 5 × 300 g × 0.5 = 750 g → 172.5 g protein / 4
    expect(m.perServing.proteinG).toBeCloseTo(43.1, 1)
  })

  it('treats a missing or out-of-range fraction as 1', () => {
    for (const edibleFraction of [undefined, null, -0.2, 1.5, Number.NaN]) {
      const e = makeEntry({ id: 'x', name: 'ternera', protein: 20, edibleFraction })
      const r = aggregateNutrition({ servings: 1, ingredients: [makeIngredient({ ingredientId: 'x', quantity: 100, unit: 'g' })] as any, catalog: catalogOf([e]) })
      expect(r.perServing.proteinG).toBe(20)
    }
  })
})

describe('aggregateNutrition — huesos de caldo y marisco con concha (PRO-281, PRO-282)', () => {
  it('edibleShare(0) es 0: lo que no se come no suma', () => {
    expect(edibleShare(0)).toBe(0)
  })

  it('«huesos para caldo 8 u» suma 0 kcal', () => {
    const huesos = makeEntry({ id: 'huesos', name: 'huesos para caldo', calories: 50, protein: 5, fat: 3, unitWeight: 250, edibleFraction: 0 })
    const r = aggregateNutrition({
      servings: 12,
      ingredients: [makeIngredient({ ingredientId: 'huesos', quantity: 8, unit: 'u', note: 'carcasas de gallina, espinazo de cerdo' })] as any,
      catalog: catalogOf([huesos]),
    })
    expect(r.perServing.kcal).toBe(0)
    expect(r.perServing.proteinG).toBe(0)
    expect(r.incomplete).toBe(false)
  })

  it('«mejillones 1.500 g» cuenta unos 420 g comestibles', () => {
    // 100 kcal y 10 g de proteína por 100 g: lo que salga ×100/10 son los gramos comestibles
    const mejillones = makeEntry({ id: 'mej', name: 'mejillones', calories: 100, protein: 10, edibleFraction: 0.28 })
    const r = aggregateNutrition({
      servings: 1,
      ingredients: [makeIngredient({ ingredientId: 'mej', quantity: 1500, unit: 'g', note: 'limpios' })] as any,
      catalog: catalogOf([mejillones]),
    })
    expect(r.perServing.kcal).toBe(420)
    expect(r.perServing.proteinG).toBe(42)
  })

  it('una línea que dice «peladas», «sin concha» o «en lomos» cuenta entera aunque el ingrediente tenga merma', () => {
    const gambas = makeEntry({ id: 'gambas', name: 'gambas', calories: 100, protein: 20, edibleFraction: 0.48 })
    const run = (note?: string) =>
      aggregateNutrition({
        servings: 1,
        ingredients: [makeIngredient({ ingredientId: 'gambas', quantity: 250, unit: 'g', note })] as any,
        catalog: catalogOf([gambas]),
      }).perServing.kcal
    expect(run('peladas; guarda cabezas y cáscaras')).toBe(250)
    expect(run('crudas y enteras')).toBe(120)
    expect(run()).toBe(120)
    expect(lineEdibleShare(0.28, 'sin concha')).toBe(1)
    expect(lineEdibleShare(0.5, 'en lomos, limpios')).toBe(1)
    expect(lineEdibleShare(0.5, 'de ración, limpias para el horno')).toBe(0.5)
    expect(lineEdibleShare(0.5, 'fileteadas en trozos; guarda cabezas y raspas')).toBe(0.5)
    expect(lineEdibleShare(1, 'peladas')).toBe(1)
  })
})
