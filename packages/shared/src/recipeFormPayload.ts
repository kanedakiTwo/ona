/**
 * Pure transformer from /recipes/new form state into the wire payload
 * that the API accepts (validated by `createRecipeSchema`).
 *
 * Lives in `@ona/shared` so the form (in `apps/web`) and the contract
 * test (in `apps/api`) reference the same function — any drift between
 * the schema and the form's payload trips the test, instead of a silent
 * "the submit button does nothing" bug in prod.
 *
 * The function is intentionally lenient: it accepts the slightly-loose
 * shape that React form state produces (`number | ""` for numeric
 * inputs, untrimmed strings, trailing empty rows) and emits a clean
 * payload. Validation is the schema's job, not this function's.
 */
import type { Meal, Season } from './constants/enums.js'

/** What the form holds for each ingredient row before submit. */
export interface IngredientRowState {
  /** UUID once an ingredient is selected; empty string while the user is still typing. */
  ingredientId: string
  /** Free-form display name typed or extracted by the LLM. */
  ingredientName: string
  /** React-controlled number input — "" while empty. */
  quantity: number | ''
  /** One of the catalog units (g/ml/u/cda/cdita/pizca/al_gusto). */
  unit: string
}

/** All form state needed to build the recipe payload. */
export interface RecipeFormState {
  name: string
  servings: number | ''
  prepTime: number | ''
  selectedMeals: Meal[]
  selectedSeasons: Season[]
  tags: string[]
  steps: string[]
  ingredientRows: IngredientRowState[]
}

export function buildRecipePayload(form: RecipeFormState): Record<string, unknown> {
  const cleanedIngredients = form.ingredientRows
    .map((r) => ({
      ...r,
      ingredientName: r.ingredientName.trim(),
    }))
    .filter((r) => r.ingredientName.length > 0)
    .map((r) => ({
      ingredientId: r.ingredientId,
      quantity: typeof r.quantity === 'number' ? r.quantity : 0,
      unit: r.unit || 'g',
    }))

  const cleanedSteps = form.steps
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text, index) => ({ index, text }))

  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    servings:
      typeof form.servings === 'number' && form.servings > 0 ? form.servings : 2,
    meals: form.selectedMeals,
    seasons: form.selectedSeasons,
    tags: form.tags,
    steps: cleanedSteps,
    ingredients: cleanedIngredients,
  }

  if (typeof form.prepTime === 'number' && form.prepTime > 0) {
    payload.prepTime = form.prepTime
  }

  return payload
}
