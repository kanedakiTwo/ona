/**
 * Unit tests for the recipe lint validator.
 *
 * Run: pnpm --filter @ona/api test
 *  or: cd apps/api && npx vitest run src/tests/recipeLint.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  lintRecipe,
  normalize,
  stem,
  levenshtein,
  type RecipeInput,
  type CatalogIngredient,
  type LintOptions,
} from '../services/recipeLint.js'

// ─── Catalog fixture ────────────────────────────────────────────

const CATALOG: CatalogIngredient[] = [
  { id: 'cat-pollo', name: 'pollo', fdcId: 1001, density: null },
  { id: 'cat-arroz', name: 'arroz', fdcId: 1002, density: null },
  { id: 'cat-cebolla', name: 'cebolla', fdcId: 1003, density: null },
  { id: 'cat-aceite', name: 'aceite de oliva', fdcId: 1004, density: 0.92 },
  { id: 'cat-sal', name: 'sal', fdcId: 1005, density: null },
  { id: 'cat-ajo', name: 'ajo', fdcId: 1006, density: null },
  { id: 'cat-salmon', name: 'salmón', fdcId: 1007, density: null },
  { id: 'cat-leche', name: 'leche', fdcId: 1008 /* density missing on purpose */ },
  { id: 'cat-zanahoria', name: 'zanahoria', fdcId: null }, // nutrition gap
  { id: 'cat-guisantes', name: 'guisantes', fdcId: 1009 },
]

const opts: LintOptions = { ingredientCatalog: CATALOG }

// ─── Helpers to build recipes ───────────────────────────────────

function makeRecipe(overrides: Partial<RecipeInput> = {}): RecipeInput {
  return {
    name: 'Pollo con arroz',
    servings: 2,
    prepTime: 10,
    cookTime: 20,
    difficulty: 'easy',
    meals: ['lunch'],
    seasons: ['spring', 'summer'],
    equipment: ['sartén'],
    tags: ['rápido'],
    internalTags: [],
    ingredients: [
      {
        id: 'row-1',
        ingredientId: 'cat-pollo',
        quantity: 300,
        unit: 'g',
        displayOrder: 0,
      },
      {
        id: 'row-2',
        ingredientId: 'cat-arroz',
        quantity: 160,
        unit: 'g',
        displayOrder: 1,
      },
      {
        id: 'row-3',
        ingredientId: 'cat-cebolla',
        quantity: 100,
        unit: 'g',
        displayOrder: 2,
      },
    ],
    steps: [
      { index: 0, text: 'Trocea el pollo y la cebolla.', durationMin: 5, ingredientRefs: ['row-1', 'row-3'] },
      { index: 1, text: 'Añade el arroz y cocina 15 minutos.', durationMin: 15, ingredientRefs: ['row-2'] },
    ],
    ...overrides,
  }
}

// ─── Helpers tests ─────────────────────────────────────────────

describe('normalize / stem / levenshtein', () => {
  it('strips diacritics and lowercases', () => {
    expect(normalize('Salmón')).toBe('salmon')
    expect(normalize('CañónAÉÍÓÚ')).toBe('canonaeiou')
  })

  it('stems Spanish plurals and gendered endings', () => {
    // cebollas (8 chars) → strip "as" → "ceboll"; cebolla → strip "a" → "ceboll" (same root)
    expect(stem('cebollas')).toBe(stem('cebolla'))
    expect(stem('huevos')).toBe('huev')
    expect(stem('tomates')).toBe('tomat')
    // short words are not stemmed
    expect(stem('pan')).toBe('pan')
    expect(stem('ajo')).toBe('ajo')
  })

  it('Levenshtein computes edit distance', () => {
    expect(levenshtein('pollo', 'pollo')).toBe(0)
    expect(levenshtein('pollo', 'polo')).toBe(1)
    // arroz → arroces requires substituting z→c, inserting e, inserting s
    expect(levenshtein('arroz', 'arroces')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
  })
})

// ─── Happy path ────────────────────────────────────────────────

describe('lintRecipe — happy path', () => {
  it('passes a well-formed recipe with no errors', () => {
    const result = lintRecipe(makeRecipe(), opts)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})

// ─── Errors ───────────────────────────────────────────────────

describe('lintRecipe — errors', () => {
  it('MISSING_NAME when name is empty', () => {
    const result = lintRecipe(makeRecipe({ name: '' }), opts)
    expect(result.errors.some(e => e.code === 'MISSING_NAME')).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('MISSING_SERVINGS when servings is < 1', () => {
    const result = lintRecipe(makeRecipe({ servings: 0 }), opts)
    expect(result.errors.some(e => e.code === 'MISSING_SERVINGS')).toBe(true)
  })

  it('NO_INGREDIENTS when ingredients array is empty', () => {
    const result = lintRecipe(makeRecipe({ ingredients: [] }), opts)
    expect(result.errors.some(e => e.code === 'NO_INGREDIENTS')).toBe(true)
  })

  it('NO_STEPS when steps array is empty', () => {
    const result = lintRecipe(makeRecipe({ steps: [] }), opts)
    expect(result.errors.some(e => e.code === 'NO_STEPS')).toBe(true)
  })

  it('STEP_INGREDIENT_NOT_LISTED when step text mentions a catalog ingredient absent from the recipe', () => {
    // Step mentions "guisantes" which is in the catalog but not in this recipe
    const recipe = makeRecipe({
      steps: [
        { index: 0, text: 'Saltea el pollo con guisantes.', durationMin: 10, ingredientRefs: ['row-1'] },
        { index: 1, text: 'Añade el arroz y la cebolla.', durationMin: 15, ingredientRefs: ['row-2', 'row-3'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    const issue = result.errors.find(e => e.code === 'STEP_INGREDIENT_NOT_LISTED')
    expect(issue).toBeDefined()
    expect(issue!.message).toContain('guisantes')
    expect(issue!.path).toBe('steps[0].text')
  })

  it('does NOT flag false positives from edit-distance neighbours (regression: "cazuela" ≠ "canela")', () => {
    // "cazuela" and "canela" differ by 2 edits in 7-char strings — earlier
    // the threshold of ≤2 fuzzy-matched them and flagged "canela" as missing
    // from the recipe even though the step only mentioned the cooking pot.
    // Same family: "pasas" should not match "pasta" / "pasa" / "vasos" etc.
    const catalog: CatalogIngredient[] = [
      ...CATALOG,
      { id: 'cat-canela', name: 'canela', fdcId: 2001, density: null },
      { id: 'cat-pasas', name: 'pasas', fdcId: 2002, density: null },
    ]
    const recipe = makeRecipe({
      steps: [
        { index: 0, text: 'En una cazuela amplia echa el aceite. Añade la cebolla.', durationMin: 5, ingredientRefs: ['row-3'] },
        { index: 1, text: 'Pica la pasta de tomate y mezcla con el pollo.', durationMin: 5, ingredientRefs: ['row-1'] },
      ],
    })
    const result = lintRecipe(recipe, { ingredientCatalog: catalog })
    const flagged = result.errors
      .filter(e => e.code === 'STEP_INGREDIENT_NOT_LISTED')
      .map(e => e.message)
    expect(flagged.some(m => m.includes('canela'))).toBe(false)
    expect(flagged.some(m => m.includes('pasas'))).toBe(false)
  })

  it('STEP_INGREDIENT_NOT_LISTED triggers on Spanish plural / inflection', () => {
    // "cebollas" should fuzzy-match "cebolla" via stemming
    const recipe = makeRecipe({
      ingredients: [
        { id: 'row-1', ingredientId: 'cat-pollo', quantity: 300, unit: 'g' },
        { id: 'row-2', ingredientId: 'cat-arroz', quantity: 160, unit: 'g' },
      ],
      steps: [
        { index: 0, text: 'Pica las cebollas y dora el pollo.', durationMin: 5, ingredientRefs: ['row-1'] },
        { index: 1, text: 'Añade el arroz.', durationMin: 15, ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'STEP_INGREDIENT_NOT_LISTED')).toBe(true)
  })

  it('does NOT fire STEP_INGREDIENT_NOT_LISTED when the ingredient is referenced via ingredientRefs', () => {
    const recipe = makeRecipe({
      ingredients: [
        { id: 'row-1', ingredientId: 'cat-pollo', quantity: 300, unit: 'g' },
        { id: 'row-2', ingredientId: 'cat-arroz', quantity: 160, unit: 'g' },
        { id: 'row-3', ingredientId: 'cat-cebolla', quantity: 100, unit: 'g' },
      ],
      steps: [
        // Mentions "cebolla" but also has it in ingredientRefs — fine
        { index: 0, text: 'Pica la cebolla.', durationMin: 5, ingredientRefs: ['row-3'] },
        { index: 1, text: 'Cocina el pollo y el arroz.', durationMin: 25, ingredientRefs: ['row-1', 'row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'STEP_INGREDIENT_NOT_LISTED')).toBe(false)
  })

  it('ORPHAN_INGREDIENT when an ingredient is never mentioned and never referenced', () => {
    const recipe = makeRecipe({
      ingredients: [
        { id: 'row-1', ingredientId: 'cat-pollo', quantity: 300, unit: 'g' },
        { id: 'row-2', ingredientId: 'cat-arroz', quantity: 160, unit: 'g' },
        { id: 'row-3', ingredientId: 'cat-ajo', quantity: 5, unit: 'g' }, // orphan
      ],
      steps: [
        { index: 0, text: 'Cocina el pollo.', durationMin: 10, ingredientRefs: ['row-1'] },
        { index: 1, text: 'Añade el arroz.', durationMin: 15, ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    const orphan = result.errors.find(e => e.code === 'ORPHAN_INGREDIENT')
    expect(orphan).toBeDefined()
    expect(orphan!.message).toContain('ajo')
  })

  it('ORPHAN_INGREDIENT exempts optional ingredients', () => {
    const recipe = makeRecipe({
      ingredients: [
        { id: 'row-1', ingredientId: 'cat-pollo', quantity: 300, unit: 'g' },
        { id: 'row-2', ingredientId: 'cat-arroz', quantity: 160, unit: 'g' },
        { id: 'row-3', ingredientId: 'cat-ajo', quantity: 5, unit: 'g', optional: true }, // optional!
      ],
      steps: [
        { index: 0, text: 'Cocina el pollo.', durationMin: 10, ingredientRefs: ['row-1'] },
        { index: 1, text: 'Añade el arroz.', durationMin: 15, ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'ORPHAN_INGREDIENT')).toBe(false)
  })

  it('QUANTITY_OUT_OF_RANGE fires when per-serving quantity exceeds the range', () => {
    // 1500 g of pollo for 2 servings = 750 g/serving (range 80–250)
    const recipe = makeRecipe({
      ingredients: [
        { id: 'row-1', ingredientId: 'cat-pollo', quantity: 1500, unit: 'g' },
        { id: 'row-2', ingredientId: 'cat-arroz', quantity: 160, unit: 'g' },
        { id: 'row-3', ingredientId: 'cat-cebolla', quantity: 100, unit: 'g' },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'QUANTITY_OUT_OF_RANGE')).toBe(true)
  })

  it('QUANTITY_OUT_OF_RANGE falls back to globalCeiling 2000 when no specific range exists', () => {
    // 5000 g of guisantes / 2 servings = 2500 g/serving > 2000 globalCeiling
    const recipe = makeRecipe({
      ingredients: [
        { id: 'row-1', ingredientId: 'cat-pollo', quantity: 200, unit: 'g' },
        { id: 'row-2', ingredientId: 'cat-arroz', quantity: 160, unit: 'g' },
        { id: 'row-3', ingredientId: 'cat-guisantes', quantity: 5000, unit: 'g' },
      ],
      steps: [
        { index: 0, text: 'Cocina el pollo.', durationMin: 10, ingredientRefs: ['row-1'] },
        { index: 1, text: 'Añade el arroz y los guisantes.', durationMin: 15, ingredientRefs: ['row-2', 'row-3'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'QUANTITY_OUT_OF_RANGE')).toBe(true)
  })

  it('force: true suppresses QUANTITY_OUT_OF_RANGE but NOT other errors', () => {
    const recipe = makeRecipe({
      name: '', // still triggers MISSING_NAME
      ingredients: [
        { id: 'row-1', ingredientId: 'cat-pollo', quantity: 1500, unit: 'g' },
        { id: 'row-2', ingredientId: 'cat-arroz', quantity: 160, unit: 'g' },
        { id: 'row-3', ingredientId: 'cat-cebolla', quantity: 100, unit: 'g' },
      ],
    })
    const result = lintRecipe(recipe, { ...opts, force: true })
    expect(result.errors.some(e => e.code === 'QUANTITY_OUT_OF_RANGE')).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_NAME')).toBe(true)
  })

  it('STEP_REF_DANGLING when a uuid in ingredientRefs has no matching row id', () => {
    const recipe = makeRecipe({
      steps: [
        { index: 0, text: 'Trocea el pollo y la cebolla.', durationMin: 5, ingredientRefs: ['row-1', 'row-99'] },
        { index: 1, text: 'Añade el arroz.', durationMin: 15, ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    const dangling = result.errors.find(e => e.code === 'STEP_REF_DANGLING')
    expect(dangling).toBeDefined()
    expect(dangling!.path).toBe('steps[0].ingredientRefs[1]')
  })

  it('TIME_INCONSISTENT when step durations exceed prep+cook by more than 20%', () => {
    // prep+cook = 30 min, sum of steps = 50 min (66% over budget)
    const recipe = makeRecipe({
      prepTime: 10,
      cookTime: 20,
      steps: [
        { index: 0, text: 'Trocea el pollo y la cebolla.', durationMin: 25, ingredientRefs: ['row-1', 'row-3'] },
        { index: 1, text: 'Añade el arroz.', durationMin: 25, ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'TIME_INCONSISTENT')).toBe(true)
  })

  it('TIME_INCONSISTENT tolerates ≤ 20 % drift', () => {
    // prep+cook = 30, sum of steps = 35 (≈17% over budget) → no error
    const recipe = makeRecipe({
      prepTime: 10,
      cookTime: 20,
      steps: [
        { index: 0, text: 'Trocea el pollo y la cebolla.', durationMin: 15, ingredientRefs: ['row-1', 'row-3'] },
        { index: 1, text: 'Añade el arroz.', durationMin: 20, ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'TIME_INCONSISTENT')).toBe(false)
  })

  it('TIME_INCONSISTENT skips check when any step has no durationMin', () => {
    const recipe = makeRecipe({
      prepTime: 10,
      cookTime: 20,
      steps: [
        { index: 0, text: 'Trocea el pollo y la cebolla.', durationMin: 100, ingredientRefs: ['row-1', 'row-3'] },
        { index: 1, text: 'Añade el arroz.', /* no durationMin */ ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'TIME_INCONSISTENT')).toBe(false)
  })

  it('TAG_LEAK_PUBLIC fires for meal name leak (case-insensitive)', () => {
    const recipe = makeRecipe({ tags: ['Lunch'] })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'TAG_LEAK_PUBLIC')).toBe(true)
  })

  it('TAG_LEAK_PUBLIC fires for difficulty leak (case-insensitive)', () => {
    const recipe = makeRecipe({ tags: ['EASY'] })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'TAG_LEAK_PUBLIC')).toBe(true)
  })

  it('TAG_LEAK_PUBLIC fires for season leak', () => {
    const recipe = makeRecipe({ tags: ['summer'] })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'TAG_LEAK_PUBLIC')).toBe(true)
  })

  it('TAG_LEAK_PUBLIC fires when a public tag duplicates an internalTag', () => {
    const recipe = makeRecipe({ tags: ['Compartida'], internalTags: ['compartida'] })
    const result = lintRecipe(recipe, opts)
    expect(result.errors.some(e => e.code === 'TAG_LEAK_PUBLIC')).toBe(true)
  })
})

// ─── Warnings ────────────────────────────────────────────────

describe('lintRecipe — warnings', () => {
  it('NUTRITION_GAP for an ingredient without fdcId', () => {
    const recipe = makeRecipe({
      ingredients: [
        { id: 'row-1', ingredientId: 'cat-pollo', quantity: 300, unit: 'g' },
        { id: 'row-2', ingredientId: 'cat-arroz', quantity: 160, unit: 'g' },
        { id: 'row-3', ingredientId: 'cat-zanahoria', quantity: 80, unit: 'g' }, // no fdcId
      ],
      steps: [
        { index: 0, text: 'Saltea el pollo con la zanahoria.', durationMin: 10, ingredientRefs: ['row-1', 'row-3'] },
        { index: 1, text: 'Añade el arroz.', durationMin: 15, ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    const warn = result.warnings.find(w => w.code === 'NUTRITION_GAP')
    expect(warn).toBeDefined()
    expect(warn!.message).toContain('zanahoria')
  })

  it('MISSING_DENSITY_FOR_ML when an ingredient uses ml but has no density', () => {
    const recipe = makeRecipe({
      ingredients: [
        { id: 'row-1', ingredientId: 'cat-pollo', quantity: 300, unit: 'g' },
        { id: 'row-2', ingredientId: 'cat-arroz', quantity: 160, unit: 'g' },
        { id: 'row-3', ingredientId: 'cat-leche', quantity: 200, unit: 'ml' }, // density missing
      ],
      steps: [
        { index: 0, text: 'Cocina el pollo en leche.', durationMin: 10, ingredientRefs: ['row-1', 'row-3'] },
        { index: 1, text: 'Añade el arroz.', durationMin: 15, ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.warnings.some(w => w.code === 'MISSING_DENSITY_FOR_ML')).toBe(true)
  })

  it('KCAL_OUT_OF_BAND for very low kcal/serving', () => {
    const recipe = makeRecipe({
      nutritionPerServing: { kcal: 80, proteinG: 5, carbsG: 10, fatG: 2, fiberG: 1, saltG: 0 },
    })
    const result = lintRecipe(recipe, opts)
    expect(result.warnings.some(w => w.code === 'KCAL_OUT_OF_BAND')).toBe(true)
  })

  it('KCAL_OUT_OF_BAND for very high kcal/serving', () => {
    const recipe = makeRecipe({
      nutritionPerServing: { kcal: 2000, proteinG: 50, carbsG: 200, fatG: 100, fiberG: 10, saltG: 2 },
    })
    const result = lintRecipe(recipe, opts)
    expect(result.warnings.some(w => w.code === 'KCAL_OUT_OF_BAND')).toBe(true)
  })

  it('KCAL_OUT_OF_BAND not emitted when nutritionPerServing absent', () => {
    const recipe = makeRecipe({})
    const result = lintRecipe(recipe, opts)
    expect(result.warnings.some(w => w.code === 'KCAL_OUT_OF_BAND')).toBe(false)
  })

  it('STEP_HAS_TIME_HINT_NO_DURATION when step text mentions minutos but durationMin is missing', () => {
    const recipe = makeRecipe({
      steps: [
        { index: 0, text: 'Trocea el pollo y la cebolla.', durationMin: 5, ingredientRefs: ['row-1', 'row-3'] },
        { index: 1, text: 'Añade el arroz y cocina 30 minutos.', /* no durationMin */ ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.warnings.some(w => w.code === 'STEP_HAS_TIME_HINT_NO_DURATION')).toBe(true)
  })

  it('STEP_HAS_TIME_HINT_NO_DURATION recognises "media hora"', () => {
    const recipe = makeRecipe({
      steps: [
        { index: 0, text: 'Trocea el pollo y la cebolla.', durationMin: 5, ingredientRefs: ['row-1', 'row-3'] },
        { index: 1, text: 'Añade el arroz y deja media hora.', /* no durationMin */ ingredientRefs: ['row-2'] },
      ],
    })
    const result = lintRecipe(recipe, opts)
    expect(result.warnings.some(w => w.code === 'STEP_HAS_TIME_HINT_NO_DURATION')).toBe(true)
  })

  it('NO_EQUIPMENT when equipment is empty', () => {
    const recipe = makeRecipe({ equipment: [] })
    const result = lintRecipe(recipe, opts)
    expect(result.warnings.some(w => w.code === 'NO_EQUIPMENT')).toBe(true)
  })
})

// ─── Performance ──────────────────────────────────────────────

describe('lintRecipe — performance', () => {
  it('completes in < 50 ms for a 30-ingredient recipe', () => {
    const big: RecipeInput = {
      name: 'Stress test',
      servings: 4,
      prepTime: 30,
      cookTime: 60,
      difficulty: 'medium',
      meals: ['lunch'],
      seasons: ['spring'],
      equipment: ['horno'],
      tags: ['rápido'],
      internalTags: [],
      ingredients: Array.from({ length: 30 }, (_, i) => ({
        id: `row-${i}`,
        ingredientId: CATALOG[i % CATALOG.length].id,
        quantity: 50,
        unit: 'g' as const,
      })),
      steps: Array.from({ length: 8 }, (_, i) => ({
        index: i,
        text: 'Cocina el pollo con arroz, cebolla, ajo, sal y aceite de oliva durante 10 minutos.',
        durationMin: 10,
        ingredientRefs: Array.from({ length: 30 }, (_, j) => `row-${j}`),
      })),
    }
    const t0 = performance.now()
    const result = lintRecipe(big, opts)
    const elapsed = performance.now() - t0
    // Don't assert on result.ok (we only care about timing here)
    expect(result).toBeDefined()
    expect(elapsed).toBeLessThan(50)
  })
})
