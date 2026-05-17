/**
 * Contract test: form payload ↔ API schema.
 *
 * Why this exists: 2026-05-15 we shipped a /recipes/new form whose
 * `buildPayload` was silently producing payloads the API rejected
 * (`servings` missing, `steps` as `string[]` instead of `{index, text}[]`).
 * The submit button looked disabled with no feedback, so the bug lived
 * for weeks. This test runs the form's *exact* payload builder against
 * `createRecipeSchema` and would have caught both regressions instantly.
 *
 * If you add or rename a field in createRecipeSchema, this test must
 * stay green — update buildRecipePayload at the same time.
 *
 * Run: pnpm --filter @ona/api test src/tests/recipeFormContract.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  buildRecipePayload,
  createRecipeSchema,
  type RecipeFormState,
} from '@ona/shared'

const UUID_A = '11111111-1111-1111-1111-111111111111'
const UUID_B = '22222222-2222-2222-2222-222222222222'

function fullState(overrides: Partial<RecipeFormState> = {}): RecipeFormState {
  return {
    name: 'Tortilla de patatas',
    servings: 4,
    prepTime: 30,
    selectedMeals: ['lunch', 'dinner'],
    selectedSeasons: ['spring', 'summer', 'autumn', 'winter'],
    tags: ['rapido'],
    steps: ['Pelar las patatas', 'Freir en aceite', 'Cuajar la tortilla'],
    ingredientRows: [
      { ingredientId: UUID_A, ingredientName: 'patata', quantity: 600, unit: 'g' },
      { ingredientId: UUID_B, ingredientName: 'huevo', quantity: 6, unit: 'u' },
    ],
    ...overrides,
  }
}

describe('buildRecipePayload — happy path', () => {
  it('produces a payload that passes createRecipeSchema with all fields', () => {
    const payload = buildRecipePayload(fullState())
    const parsed = createRecipeSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
  })

  it('includes servings as a positive integer (regression: missing servings)', () => {
    const payload = buildRecipePayload(fullState({ servings: 4 }))
    expect(payload).toMatchObject({ servings: 4 })
  })

  it('defaults servings to 2 when the user leaves the field blank', () => {
    const payload = buildRecipePayload(fullState({ servings: '' }))
    expect(payload).toMatchObject({ servings: 2 })
    expect(createRecipeSchema.safeParse(payload).success).toBe(true)
  })

  it('transforms step strings into {index, text} objects (regression: steps as string[])', () => {
    const payload = buildRecipePayload(
      fullState({ steps: ['paso A', 'paso B', 'paso C'] }),
    )
    expect(payload).toMatchObject({
      steps: [
        { index: 0, text: 'paso A' },
        { index: 1, text: 'paso B' },
        { index: 2, text: 'paso C' },
      ],
    })
  })
})

describe('buildRecipePayload — cleaning', () => {
  it('drops ingredient rows where the user typed nothing', () => {
    const payload = buildRecipePayload(
      fullState({
        ingredientRows: [
          { ingredientId: UUID_A, ingredientName: 'patata', quantity: 600, unit: 'g' },
          { ingredientId: '', ingredientName: '   ', quantity: '', unit: 'g' },
          { ingredientId: '', ingredientName: '', quantity: '', unit: 'g' },
        ],
      }),
    )
    expect((payload.ingredients as unknown[]).length).toBe(1)
  })

  it('drops trailing empty steps', () => {
    const payload = buildRecipePayload(
      fullState({ steps: ['paso A', '   ', '', 'paso B', ''] }),
    )
    expect(payload).toMatchObject({
      steps: [
        { index: 0, text: 'paso A' },
        { index: 1, text: 'paso B' },
      ],
    })
  })

  it('omits prepTime when blank or 0', () => {
    const blank = buildRecipePayload(fullState({ prepTime: '' }))
    const zero = buildRecipePayload(fullState({ prepTime: 0 }))
    expect(blank).not.toHaveProperty('prepTime')
    expect(zero).not.toHaveProperty('prepTime')
  })
})

describe('display fields + servingsConfidence (PR 2.3)', () => {
  it('payload with displayQuantity/displayUnit passes createRecipeSchema', () => {
    const state = fullState({
      ingredientRows: [
        { ingredientId: UUID_A, ingredientName: 'aceite de oliva virgen', quantity: 30, unit: 'ml',
          displayQuantity: 2, displayUnit: 'cda' },
      ],
    })
    const payload = buildRecipePayload(state)
    const result = createRecipeSchema.safeParse(payload)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ingredients[0]).toMatchObject({
        ingredientId: UUID_A, quantity: 30, unit: 'ml',
        displayQuantity: 2, displayUnit: 'cda',
      })
    }
  })

  it('payload without display fields still passes (nullable optional)', () => {
    const state = fullState({
      ingredientRows: [
        { ingredientId: UUID_A, ingredientName: 'aceite', quantity: 30, unit: 'ml' },
        // no displayQuantity, no displayUnit
      ],
    })
    const payload = buildRecipePayload(state)
    expect(createRecipeSchema.safeParse(payload).success).toBe(true)
  })

  it('servingsConfidence defaults to "explicit" when omitted', () => {
    const state = fullState()  // no servingsConfidence in state
    const payload = buildRecipePayload(state)
    const result = createRecipeSchema.safeParse(payload)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.servingsConfidence).toBe('explicit')
    }
  })

  it('servingsConfidence accepts "estimated"', () => {
    const state = fullState({ servingsConfidence: 'estimated' })
    const payload = buildRecipePayload(state)
    const result = createRecipeSchema.safeParse(payload)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.servingsConfidence).toBe('estimated')
    }
  })

  it('servingsConfidence rejects invalid values', () => {
    const state = fullState()
    const payload = buildRecipePayload(state)
    // mutate after build to inject an invalid value
    ;(payload as { servingsConfidence: unknown }).servingsConfidence = 'guessed'
    expect(createRecipeSchema.safeParse(payload).success).toBe(false)
  })
})

describe('buildRecipePayload — fails the schema only when expected', () => {
  it('fails when name is blank (real validation error)', () => {
    const payload = buildRecipePayload(fullState({ name: '   ' }))
    const parsed = createRecipeSchema.safeParse(payload)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === 'name')).toBe(true)
    }
  })

  it('fails when meals are empty', () => {
    const payload = buildRecipePayload(fullState({ selectedMeals: [] }))
    const parsed = createRecipeSchema.safeParse(payload)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === 'meals')).toBe(true)
    }
  })

  it('fails when ingredient list is empty', () => {
    const payload = buildRecipePayload(
      fullState({
        ingredientRows: [
          { ingredientId: '', ingredientName: '', quantity: '', unit: 'g' },
        ],
      }),
    )
    const parsed = createRecipeSchema.safeParse(payload)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === 'ingredients')).toBe(true)
    }
  })
})
