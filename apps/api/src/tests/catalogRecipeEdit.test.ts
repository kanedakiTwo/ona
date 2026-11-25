/**
 * PRO-1290 — the allergen audit before a catalogue recipe fix is saved, and
 * how the patch lands on the saved recipe (services/catalogRecipeEdit.ts).
 * The save itself (SQL, audit row) is in adminFixes.smoke.ts.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { allergenAudit, applyPatch } from '../services/catalogRecipeEdit.js'
import type { RecipeWriteInput } from '../services/recipePersistence.js'

const base = { steps: ['Mezcla la harina con el azúcar.', 'Hornea 20 minutos.'], ingredientNames: ['Harina de trigo', 'Azúcar'] }

describe('allergenAudit', () => {
  it('nothing to say when the allergens stay and the steps name only what is listed', () => {
    expect(allergenAudit({ ...base, before: ['gluten'], after: ['gluten'] })).toEqual([])
  })

  it('an allergen lost is held unless «allergens» confirms it', () => {
    const issues = allergenAudit({ ...base, before: ['gluten', 'huevo'], after: ['gluten'] })
    expect(issues).toMatchObject([{ code: 'ALLERGEN_LOST', lost: ['huevo'] }])
    expect(issues[0].message).toContain('huevo')
    expect(allergenAudit({ ...base, before: ['gluten', 'huevo'], after: ['gluten'], declared: ['gluten'] })).toEqual([])
  })

  it('«allergens» must match what the ingredients carry, both ways', () => {
    expect(allergenAudit({ ...base, before: [], after: ['gluten'], declared: ['gluten', 'lactosa'] })).toMatchObject([
      { code: 'ALLERGENS_MISMATCH', missing: ['lactosa'], extra: [] },
    ])
    expect(allergenAudit({ ...base, before: [], after: ['gluten', 'sesamo'], declared: ['gluten'] })).toMatchObject([
      { code: 'ALLERGENS_MISMATCH', missing: [], extra: ['sesamo'] },
    ])
  })

  it('a step naming an allergen the ingredients lack is held; acceptMentions lets a checked term through', () => {
    const steps = ['Funde la mantequilla.', 'Mezcla la harina con el azúcar.']
    const issues = allergenAudit({ ...base, steps, before: ['gluten'], after: ['gluten'] })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'STEP_MENTIONS', mentions: [{ step: 1, term: 'mantequilla', category: 'lacteos' }] })
    expect(allergenAudit({ ...base, steps, before: ['gluten'], after: ['gluten'], acceptMentions: ['Mantequilla'] })).toEqual([])
    expect(allergenAudit({ ...base, steps, ingredientNames: [...base.ingredientNames, 'Mantequilla'], before: ['gluten'], after: ['gluten', 'lactosa'] })).toEqual([])
  })
})

describe('applyPatch', () => {
  const A = '00000000-0000-4000-8000-00000000000a'
  const B = '00000000-0000-4000-8000-00000000000b'
  const saved: RecipeWriteInput = {
    name: 'Bizcocho',
    servings: 4,
    meals: ['snack'],
    prepTime: 10,
    cookTime: 30,
    tags: ['horno'],
    ingredients: [
      { id: A, ingredientId: 'i-harina', quantity: 200, unit: 'g' },
      { id: B, ingredientId: 'i-huevo', quantity: 3, unit: 'u' },
    ],
    steps: [{ index: 0, text: 'Bate los huevos con la harina.', ingredientRefs: [A, B] }],
  }

  it('keeps what is not sent', () => {
    expect(applyPatch(saved, { cookTime: 25 })).toEqual({ ...saved, cookTime: 25 })
    expect(applyPatch(saved, { prepTime: null }).prepTime).toBeNull()
  })

  it('a new ingredient list drops the kept steps’ links to rows that left', () => {
    const next = applyPatch(saved, { ingredients: [{ id: A, ingredientId: 'i-harina', quantity: 250, unit: 'g' }] })
    expect(next.ingredients).toEqual([{ id: A, ingredientId: 'i-harina', quantity: 250, unit: 'g', displayOrder: 0 }])
    expect(next.steps[0].ingredientRefs).toEqual([A])
  })

  it('new steps are numbered in order; tags replace', () => {
    const next = applyPatch(saved, { steps: [{ text: 'Uno.' }, { text: 'Dos.', ingredientRefs: ['ing_0'] }], tags: [] })
    expect(next.steps).toEqual([
      { text: 'Uno.', index: 0, ingredientRefs: [] },
      { text: 'Dos.', index: 1, ingredientRefs: ['ing_0'] },
    ])
    expect(next.tags).toEqual([])
  })
})
