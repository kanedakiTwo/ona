/**
 * PRO-1259 — saving a recipe doesn't wipe what the form doesn't send: the
 * PUT keeps the fields left out, and an ingredient row sent with its id
 * keeps it (so the steps' `ingredientRefs` still point at it).
 * The same against the real API + DB: recipeUpdateKeeps.smoke.ts.
 */
import { describe, expect, it } from 'vitest'
import { createRecipeSchema, updateRecipeSchema } from '@ona/shared'
import { assignIngredientRowIds } from '../services/recipePersistence.js'
import { withKeptFields } from '../routes/recipes.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
let n = 0
const mint = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

describe('assignIngredientRowIds', () => {
  it('keeps the ids sent and mints for the rows without one', () => {
    n = 0
    const { rowIds, alias } = assignIngredientRowIds([A, undefined, B], new Set(), mint)
    expect(rowIds).toEqual([A, '00000000-0000-4000-8000-000000000001', B])
    expect(alias.size).toBe(0)
  })

  it("another recipe's row id is not taken: a new one, and the steps' refs follow it", () => {
    n = 0
    const { rowIds, alias } = assignIngredientRowIds([A, C], new Set([C]), mint)
    expect(rowIds).toEqual([A, '00000000-0000-4000-8000-000000000001'])
    expect(alias.get(C)).toBe('00000000-0000-4000-8000-000000000001')
  })

  it('a repeated id: the first row keeps it, the second gets a new one', () => {
    n = 0
    const { rowIds, alias } = assignIngredientRowIds([A, A], new Set(), mint)
    expect(rowIds).toEqual([A, '00000000-0000-4000-8000-000000000001'])
    expect(alias.has(A)).toBe(false)
  })

  it('what is not a UUID is not kept nor aliased (an `ing_0` placeholder stays a placeholder)', () => {
    n = 0
    const { rowIds, alias } = assignIngredientRowIds(['ing_0', 'x'], new Set(), mint)
    expect(rowIds).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'])
    expect(alias.size).toBe(0)
  })
})

describe('withKeptFields (PUT /recipes/:id)', () => {
  const saved = {
    notes: 'La abuela la hacía con cebolla pochada.',
    tips: 'Sala el agua al final.',
    substitutions: 'Sin huevo: aquafaba.',
    storage: 'Tres días en nevera.',
    moreTime: 'Con garbanzo seco en remojo la víspera queda más meloso.',
    course: 'main',
    activeTime: 15,
    prepTime: 10,
    internalTags: ['compartida', 'tiempos-pro284'],
    equipment: ['horno'],
  }

  it('a PUT without tips / notes / course keeps them, and the rest it leaves out', () => {
    const body = { name: 'Tortilla', servings: 2, meals: ['lunch' as const], ingredients: [], steps: [] }
    const out = withKeptFields(body, saved)
    expect(out).toMatchObject(saved)
    expect(out.name).toBe('Tortilla')
  })

  it('what the body sends wins, also null and empty', () => {
    const out = withKeptFields({ notes: '', course: null, prepTime: null, internalTags: [] }, saved)
    expect(out.notes).toBe('')
    expect(out.course).toBeNull()
    expect(out.prepTime).toBeNull()
    expect(out.internalTags).toEqual([])
    expect(out.tips).toBe(saved.tips)
  })

  it('the update schema neither fills nor drops: absent stays absent, the row id goes through', () => {
    const parsed = updateRecipeSchema.parse({
      name: 'X',
      ingredients: [{ id: A, ingredientId: B, quantity: 1, unit: 'u' }],
      steps: [{ index: 0, text: 'Paso', ingredientRefs: [A] }],
    })
    expect(parsed.internalTags).toBeUndefined()
    expect(parsed.tips).toBeUndefined()
    expect(parsed.ingredients?.[0].id).toBe(A)
    expect(parsed.steps?.[0].ingredientRefs).toEqual([A])
    // The form's own check: a cleared time is null, not a failure.
    expect(createRecipeSchema.safeParse({ ...parsed, servings: 2, meals: ['lunch'], prepTime: null }).success).toBe(true)
  })

  it('D-1028: «Y si tienes más tiempo…» survives a save that does not send it; \'\' clears it', () => {
    expect(withKeptFields({ name: 'Cocido' }, saved).moreTime).toBe(saved.moreTime)
    expect(withKeptFields({ moreTime: '' }, saved).moreTime).toBe('')
    expect(withKeptFields({ moreTime: 'Otra cosa.' }, saved).moreTime).toBe('Otra cosa.')
    expect(updateRecipeSchema.parse({ name: 'X' }).moreTime).toBeUndefined()
  })
})
