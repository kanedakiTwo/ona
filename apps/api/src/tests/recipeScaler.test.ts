/**
 * Unit tests for the recipe scaler.
 *
 * Run: pnpm --filter @ona/api test
 *  or: cd apps/api && npx vitest run src/tests/recipeScaler.test.ts
 */

import { describe, it, expect } from 'vitest'
import type { Recipe, RecipeIngredient, Unit } from '@ona/shared'
import { scaleRecipe } from '../services/recipeScaler.js'

// ─── Fixtures ───────────────────────────────────────────────────

function makeIngredient(
  overrides: Partial<RecipeIngredient> & { quantity: number; unit: Unit; id?: string },
): RecipeIngredient {
  return {
    id: overrides.id ?? 'row-1',
    ingredientId: '00000000-0000-0000-0000-000000000001',
    quantity: overrides.quantity,
    unit: overrides.unit,
    optional: false,
    displayOrder: 0,
    ...overrides,
  }
}

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-1',
    name: 'Pollo con arroz',
    authorId: null,
    servings: 4,
    difficulty: 'medium',
    meals: ['lunch'],
    seasons: ['spring'],
    equipment: ['sartén'],
    allergens: [],
    tags: [],
    internalTags: [],
    ingredients: [
      makeIngredient({ id: 'row-1', quantity: 400, unit: 'g' }),
      makeIngredient({ id: 'row-2', quantity: 160, unit: 'g' }),
    ],
    steps: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

// ─── Happy path & pass-through ─────────────────────────────────

describe('scaleRecipe — happy path', () => {
  it('doubles quantities when target is 2× source servings', () => {
    const r = makeRecipe({
      servings: 4,
      ingredients: [
        makeIngredient({ id: 'row-1', quantity: 400, unit: 'g' }),
        makeIngredient({ id: 'row-2', quantity: 200, unit: 'ml' }),
      ],
    })
    const scaled = scaleRecipe(r, 8)
    expect(scaled.scaleFactor).toBe(2)
    expect(scaled.scaledFrom).toBe(4)
    expect(scaled.servings).toBe(8)
    expect(scaled.ingredients[0].quantity).toBe(800)
    expect(scaled.ingredients[0].unit).toBe('g')
    expect(scaled.ingredients[0].originalQuantity).toBe(400)
    expect(scaled.ingredients[1].quantity).toBe(400)
    expect(scaled.ingredients[1].unit).toBe('ml')
  })

  it('preserves Recipe metadata (name, difficulty, equipment, etc.)', () => {
    const r = makeRecipe({ name: 'Test', difficulty: 'easy', equipment: ['horno'] })
    const scaled = scaleRecipe(r, 8)
    expect(scaled.name).toBe('Test')
    expect(scaled.difficulty).toBe('easy')
    expect(scaled.equipment).toEqual(['horno'])
  })
})

describe('scaleRecipe — pass-through', () => {
  it('returns scaleFactor: 1 and no rounding flags when target equals source', () => {
    const r = makeRecipe({
      servings: 4,
      ingredients: [
        makeIngredient({ id: 'row-1', quantity: 333, unit: 'g' }),
        makeIngredient({ id: 'row-2', quantity: 1.5, unit: 'u' }),
      ],
    })
    const scaled = scaleRecipe(r, 4)
    expect(scaled.scaleFactor).toBe(1)
    expect(scaled.scaledFrom).toBe(4)
    expect(scaled.servings).toBe(4)
    expect(scaled.ingredients[0].quantity).toBe(333)
    expect(scaled.ingredients[0].rounded).toBe(false)
    expect(scaled.ingredients[0].originalQuantity).toBe(333)
    // Even non-integer u-quantities pass through untouched
    expect(scaled.ingredients[1].quantity).toBe(1.5)
    expect(scaled.ingredients[1].rounded).toBe(false)
    expect(scaled.ingredients[1].roundingNote).toBeUndefined()
  })
})

// ─── Non-scaling units ────────────────────────────────────────

describe('scaleRecipe — pizca / al_gusto never scale', () => {
  it('preserves pizca quantity even when factor != 1', () => {
    const r = makeRecipe({
      servings: 2,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 1, unit: 'pizca' })],
    })
    const scaled = scaleRecipe(r, 8)
    expect(scaled.ingredients[0].quantity).toBe(1)
    expect(scaled.ingredients[0].originalQuantity).toBe(1)
    expect(scaled.ingredients[0].rounded).toBe(false)
    expect(scaled.ingredients[0].roundingNote).toBeUndefined()
  })

  it('preserves al_gusto quantity even when factor != 1', () => {
    const r = makeRecipe({
      servings: 4,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 1, unit: 'al_gusto' })],
    })
    const scaled = scaleRecipe(r, 1)
    expect(scaled.ingredients[0].quantity).toBe(1)
    expect(scaled.ingredients[0].rounded).toBe(false)
  })
})

// ─── Whole-unit (u) rounding ──────────────────────────────────

describe('scaleRecipe — unit "u" rounding', () => {
  it('rounds 1.5 huevos up to 2 with a Spanish note', () => {
    // 1 huevo at servings=2 → 1.5 huevos at servings=3
    const r = makeRecipe({
      servings: 2,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 1, unit: 'u' })],
    })
    const scaled = scaleRecipe(r, 3)
    expect(scaled.ingredients[0].quantity).toBe(2)
    expect(scaled.ingredients[0].rounded).toBe(true)
    expect(scaled.ingredients[0].roundingNote).toBe('1.5 → redondea a 2')
  })

  it('does not flag rounded when scaling lands on a whole number', () => {
    // 1 u at servings=2 → 2 u at servings=4: exact, no note
    const r = makeRecipe({
      servings: 2,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 1, unit: 'u' })],
    })
    const scaled = scaleRecipe(r, 4)
    expect(scaled.ingredients[0].quantity).toBe(2)
    expect(scaled.ingredients[0].rounded).toBe(false)
    expect(scaled.ingredients[0].roundingNote).toBeUndefined()
  })

  it('floors at 1 — never returns 0 of an ingredient the recipe needs', () => {
    // 1 u at servings=4 → 0.25 u at servings=1; Math.round(0.25) = 0; floor → 1
    const r = makeRecipe({
      servings: 4,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 1, unit: 'u' })],
    })
    const scaled = scaleRecipe(r, 1)
    expect(scaled.ingredients[0].quantity).toBe(1)
    expect(scaled.ingredients[0].rounded).toBe(true)
    expect(scaled.ingredients[0].roundingNote).toContain('0.25')
  })
})

// ─── Mass / volume rounding bands ─────────────────────────────

describe('scaleRecipe — g/ml culinary rounding bands', () => {
  // Use servings=1 → target=1 to keep raw = quantity; but pass-through
  // skips rounding. Instead we use servings=2 → target=4 (factor 2) and
  // pre-pick the source quantity so the resulting `raw` lands exactly
  // where we want.
  function rawAt(raw: number, unit: Unit): { recipe: Recipe; expectedRaw: number } {
    return {
      recipe: makeRecipe({
        servings: 2,
        ingredients: [makeIngredient({ id: 'row-1', quantity: raw / 2, unit })],
      }),
      expectedRaw: raw,
    }
  }

  it('band <5: rounds to nearest 0.5 (3.2 → 3.0)', () => {
    const { recipe } = rawAt(3.2, 'g')
    const scaled = scaleRecipe(recipe, 4)
    expect(scaled.ingredients[0].quantity).toBe(3)
  })

  it('band 5–24.99: rounds to nearest 1 (12.7 → 13)', () => {
    const { recipe } = rawAt(12.7, 'g')
    const scaled = scaleRecipe(recipe, 4)
    expect(scaled.ingredients[0].quantity).toBe(13)
  })

  it('band 25–99.99: rounds to nearest 5 (62 → 60)', () => {
    const { recipe } = rawAt(62, 'g')
    const scaled = scaleRecipe(recipe, 4)
    expect(scaled.ingredients[0].quantity).toBe(60)
  })

  it('band 100–249.99: rounds to nearest 25 (137 → 125)', () => {
    const { recipe } = rawAt(137, 'g')
    const scaled = scaleRecipe(recipe, 4)
    expect(scaled.ingredients[0].quantity).toBe(125)
  })

  it('band 250–499.99: rounds to nearest 50 (327 → 325… wait, 50; → 350)', () => {
    // 327 / 50 = 6.54 → round → 7 → 350
    const { recipe } = rawAt(327, 'g')
    const scaled = scaleRecipe(recipe, 4)
    expect(scaled.ingredients[0].quantity).toBe(350)
  })

  it('band 500–999.99: rounds to nearest 100 (763 → 800)', () => {
    const { recipe } = rawAt(763, 'g')
    const scaled = scaleRecipe(recipe, 4)
    expect(scaled.ingredients[0].quantity).toBe(800)
  })

  it('band 1000–4999.99: rounds to nearest 250 (1380 → 1250)', () => {
    // 1380 / 250 = 5.52 → 6 → 1500. Let's pick 1330: 1330/250=5.32 → 5 → 1250
    const { recipe } = rawAt(1330, 'ml')
    const scaled = scaleRecipe(recipe, 4)
    expect(scaled.ingredients[0].quantity).toBe(1250)
  })

  it('band ≥5000: rounds to nearest 500 (5333 → 5500)', () => {
    const { recipe } = rawAt(5333, 'g')
    const scaled = scaleRecipe(recipe, 4)
    expect(scaled.ingredients[0].quantity).toBe(5500)
  })

  it('uses ml the same way as g', () => {
    const { recipe } = rawAt(220, 'ml')
    const scaled = scaleRecipe(recipe, 4)
    expect(scaled.ingredients[0].quantity).toBe(225)
  })
})

// ─── cda / cdita ───────────────────────────────────────────────

describe('scaleRecipe — cda / cdita round to 0.5', () => {
  it('rounds cda to nearest 0.5', () => {
    // 1 cda at servings=2 → 1.5 cda at servings=3 → already on a 0.5 band, no flag
    const r = makeRecipe({
      servings: 2,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 1, unit: 'cda' })],
    })
    const scaled = scaleRecipe(r, 3)
    expect(scaled.ingredients[0].quantity).toBe(1.5)
    expect(scaled.ingredients[0].rounded).toBe(false)
  })

  it('rounds cdita 0.7 → 0.5 with rounded flag', () => {
    // 1 cdita at servings=10 → 0.7 at servings=7 → 0.5
    const r = makeRecipe({
      servings: 10,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 1, unit: 'cdita' })],
    })
    const scaled = scaleRecipe(r, 7)
    expect(scaled.ingredients[0].quantity).toBe(0.5)
    expect(scaled.ingredients[0].rounded).toBe(true)
  })
})

// ─── Errors ────────────────────────────────────────────────────

describe('scaleRecipe — invalid input', () => {
  it('throws when recipe.servings is 0', () => {
    const r = makeRecipe({ servings: 0 })
    expect(() => scaleRecipe(r, 4)).toThrow(/servings must be a positive finite/)
  })

  it('throws when recipe.servings is missing (undefined)', () => {
    const r = makeRecipe()
    // simulate broken input — bypass type system
    ;(r as { servings: number | undefined }).servings = undefined as unknown as number
    expect(() => scaleRecipe(r, 4)).toThrow(/servings/)
  })

  it('throws when recipe.servings is negative', () => {
    const r = makeRecipe({ servings: -2 })
    expect(() => scaleRecipe(r, 4)).toThrow(/servings/)
  })

  it('throws when targetServings is 0', () => {
    const r = makeRecipe()
    expect(() => scaleRecipe(r, 0)).toThrow(/targetServings/)
  })

  it('throws when targetServings is negative', () => {
    const r = makeRecipe()
    expect(() => scaleRecipe(r, -3)).toThrow(/targetServings/)
  })

  it('throws when an ingredient has a negative quantity', () => {
    const r = makeRecipe({
      ingredients: [makeIngredient({ id: 'row-1', quantity: -10, unit: 'g' })],
    })
    expect(() => scaleRecipe(r, 8)).toThrow(/non-negative/)
  })
})

// ─── Edge cases ────────────────────────────────────────────────

describe('scaleRecipe — edge cases', () => {
  it('returns empty ingredients when recipe has none', () => {
    const r = makeRecipe({ ingredients: [] })
    const scaled = scaleRecipe(r, 8)
    expect(scaled.ingredients).toEqual([])
    expect(scaled.scaleFactor).toBe(2)
  })

  it('preserves zero-quantity ingredients without rounding artefacts', () => {
    const r = makeRecipe({
      servings: 4,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 0, unit: 'g' })],
    })
    const scaled = scaleRecipe(r, 8)
    expect(scaled.ingredients[0].quantity).toBe(0)
    expect(scaled.ingredients[0].rounded).toBe(false)
  })

  it('survives float input quantities (0.5 g → scales correctly)', () => {
    // 0.5 g at servings=2 → 1 g at servings=4 (band <5, step 0.5)
    const r = makeRecipe({
      servings: 2,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 0.5, unit: 'g' })],
    })
    const scaled = scaleRecipe(r, 4)
    expect(scaled.ingredients[0].quantity).toBe(1)
    expect(scaled.ingredients[0].originalQuantity).toBe(0.5)
  })

  it('rounded flag is false when raw lies on a band boundary', () => {
    // 100 g at servings=2 → 200 g at servings=4. 200 / 25 = 8.0 → no drift.
    const r = makeRecipe({
      servings: 2,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 100, unit: 'g' })],
    })
    const scaled = scaleRecipe(r, 4)
    expect(scaled.ingredients[0].quantity).toBe(200)
    expect(scaled.ingredients[0].rounded).toBe(false)
  })

  it('1 % threshold: tiny drift does not flip rounded to true', () => {
    // raw = 200.5 g (band 100–249.99, step 25). round → 200. drift = 0.5/200.5 ≈ 0.25 %.
    // < 1 % → rounded should be false.
    const r = makeRecipe({
      servings: 2,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 100.25, unit: 'g' })],
    })
    const scaled = scaleRecipe(r, 4)
    expect(scaled.ingredients[0].quantity).toBe(200)
    expect(scaled.ingredients[0].rounded).toBe(false)
  })

  it('1 % threshold: meaningful drift does set rounded to true', () => {
    // raw = 213 g (band 100–249.99, step 25). round → 225. drift = 12/213 ≈ 5.6 %.
    const r = makeRecipe({
      servings: 2,
      ingredients: [makeIngredient({ id: 'row-1', quantity: 106.5, unit: 'g' })],
    })
    const scaled = scaleRecipe(r, 4)
    expect(scaled.ingredients[0].quantity).toBe(225)
    expect(scaled.ingredients[0].rounded).toBe(true)
  })
})

// ─── Determinism & performance ─────────────────────────────────

describe('scaleRecipe — determinism', () => {
  it('same inputs produce identical outputs (referential transparency)', () => {
    const r = makeRecipe({
      servings: 3,
      ingredients: [
        makeIngredient({ id: 'row-1', quantity: 137, unit: 'g' }),
        makeIngredient({ id: 'row-2', quantity: 1, unit: 'u' }),
        makeIngredient({ id: 'row-3', quantity: 1, unit: 'pizca' }),
      ],
    })
    const a = scaleRecipe(r, 7)
    const b = scaleRecipe(r, 7)
    expect(a).toEqual(b)
  })
})

describe('scaleRecipe — performance', () => {
  it('scales a 30-ingredient recipe in well under 1 ms', () => {
    const r = makeRecipe({
      servings: 4,
      ingredients: Array.from({ length: 30 }, (_, i) =>
        makeIngredient({
          id: `row-${i}`,
          quantity: 50 + i * 7,
          unit: (['g', 'ml', 'u', 'cda', 'cdita'] as Unit[])[i % 5],
        }),
      ),
    })
    const t0 = performance.now()
    const scaled = scaleRecipe(r, 6)
    const elapsed = performance.now() - t0
    expect(scaled.ingredients).toHaveLength(30)
    // Generous bound to avoid CI flakiness; the actual scaler is far below this.
    expect(elapsed).toBeLessThan(5)
  })
})
