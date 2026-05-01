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
