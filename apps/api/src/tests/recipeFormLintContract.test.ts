/**
 * Second-layer contract test: form payload → recipeLint.
 *
 * The `recipeFormContract.test.ts` only covers the first validation
 * layer (zod's `createRecipeSchema`). The 2026-05-16 422 ("Request
 * failed") proved that wasn't enough: a payload that passes zod can
 * still be rejected by the server-side lint validator (orphan ingredients,
 * steps mentioning unlisted ingredients, missing density for ml, …) and
 * the form had no clue what went wrong.
 *
 * This test composes the form's *real* payload builder with the *real*
 * lint validator (against a synthetic catalog) so any drift between the
 * form and the lint ruleset fails CI instead of becoming a silent 422.
 */

import { describe, it, expect } from 'vitest'
import {
  buildRecipePayload,
  type RecipeFormState,
} from '@ona/shared'
import { lintRecipe, type CatalogIngredient } from '../services/recipeLint.js'

const ROW_A = '11111111-1111-1111-1111-111111111111'
const ROW_B = '22222222-2222-2222-2222-222222222222'
const PATATA = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'
const HUEVO = 'aaaaaaaa-2222-2222-2222-aaaaaaaaaaaa'
const TOMATE = 'aaaaaaaa-3333-3333-3333-aaaaaaaaaaaa'

const catalog: CatalogIngredient[] = [
  { id: PATATA, name: 'patata', density: null, unitWeight: 150 },
  { id: HUEVO, name: 'huevo', density: null, unitWeight: 50 },
  { id: TOMATE, name: 'tomate', density: null, unitWeight: 100 },
]

function formState(overrides: Partial<RecipeFormState> = {}): RecipeFormState {
  return {
    name: 'Tortilla de patatas',
    servings: 4,
    prepTime: 30,
    selectedMeals: ['lunch', 'dinner'],
    selectedSeasons: ['spring', 'summer', 'autumn', 'winter'],
    tags: [],
    steps: [
      'Pelar y cortar la patata en rodajas',
      'Batir el huevo con sal',
      'Cuajar la tortilla en la sarten',
    ],
    ingredientRows: [
      { ingredientId: PATATA, ingredientName: 'patata', quantity: 600, unit: 'g' },
      { ingredientId: HUEVO, ingredientName: 'huevo', quantity: 6, unit: 'u' },
    ],
    ...overrides,
  }
}

/**
 * Transform a payload built from form state into the shape lintRecipe
 * expects. Mirrors the pre-processing persistRecipe does (mint row ids,
 * promote steps to {index, text} — buildRecipePayload already does that
 * second part). Pure; no DB.
 */
function toLintInput(form: RecipeFormState) {
  const payload = buildRecipePayload(form) as {
    name: string
    servings: number
    meals: string[]
    seasons: string[]
    tags: string[]
    ingredients: Array<{ ingredientId: string; quantity: number; unit: string }>
    steps: Array<{ index: number; text: string }>
    prepTime?: number
  }
  const rowIds = [ROW_A, ROW_B].slice(0, payload.ingredients.length)
  return {
    name: payload.name,
    servings: payload.servings,
    prepTime: payload.prepTime ?? null,
    meals: payload.meals as ('lunch' | 'dinner' | 'breakfast' | 'snack')[],
    seasons: payload.seasons as ('spring' | 'summer' | 'autumn' | 'winter')[],
    tags: payload.tags,
    ingredients: payload.ingredients.map((ing, i) => ({
      id: rowIds[i],
      ingredientId: ing.ingredientId,
      quantity: ing.quantity,
      unit: ing.unit as 'g' | 'ml' | 'u' | 'cda' | 'cdita' | 'pizca' | 'al_gusto',
      optional: false,
      displayOrder: i,
    })),
    steps: payload.steps.map((s) => ({ ...s, ingredientRefs: [] as string[] })),
  }
}

describe('form → recipeLint contract', () => {
  it('a clean form (steps mention listed ingredients, no orphans) passes lint', () => {
    const result = lintRecipe(toLintInput(formState()), { ingredientCatalog: catalog })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('catches STEP_INGREDIENT_NOT_LISTED when a step names something not in the list', () => {
    // Step says "tomate" but no tomate row in ingredients.
    const result = lintRecipe(
      toLintInput(
        formState({
          steps: ['Pelar la patata', 'Saltear con tomate fresco', 'Servir'],
        }),
      ),
      { ingredientCatalog: catalog },
    )
    expect(result.ok).toBe(false)
    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('STEP_INGREDIENT_NOT_LISTED')
  })

  it('catches ORPHAN_INGREDIENT when an ingredient is never mentioned in any step', () => {
    const result = lintRecipe(
      toLintInput(
        formState({
          // Add tomate row but never reference it in any step.
          ingredientRows: [
            { ingredientId: PATATA, ingredientName: 'patata', quantity: 600, unit: 'g' },
            { ingredientId: HUEVO, ingredientName: 'huevo', quantity: 6, unit: 'u' },
            { ingredientId: TOMATE, ingredientName: 'tomate', quantity: 200, unit: 'g' },
          ],
        }),
      ),
      { ingredientCatalog: catalog },
    )
    expect(result.ok).toBe(false)
    const orphans = result.errors.filter((e) => e.code === 'ORPHAN_INGREDIENT')
    expect(orphans.length).toBeGreaterThan(0)
  })

  it('reports issues with paths like "steps[N].text" / "ingredients[N]" so the form can pin them', () => {
    const result = lintRecipe(
      toLintInput(
        formState({
          steps: ['Saltear con tomate fresco', 'Servir'],
        }),
      ),
      { ingredientCatalog: catalog },
    )
    expect(result.ok).toBe(false)
    const stepIssue = result.errors.find((e) => e.code === 'STEP_INGREDIENT_NOT_LISTED')
    expect(stepIssue?.path).toMatch(/^steps\[\d+\]/)
  })
})
