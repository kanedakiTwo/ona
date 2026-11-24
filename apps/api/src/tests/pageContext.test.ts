/**
 * The floating companion tells Mimo what the user is looking at (D-023):
 * "esta receta" on a recipe, "siguiente" while cooking.
 */
import { describe, it, expect } from 'vitest'
import { cookStepOf, describePage, pageContextNote, withPageContext } from '../services/assistant/pageContext.js'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('describePage', () => {
  it.each([
    [`/recipes/${ID}`, { kind: 'recipe', recipeId: ID }],
    [`/recipes/${ID}/edit`, { kind: 'recipe', recipeId: ID }],
    [`/recipes/${ID}/cook?servings=2`, { kind: 'cooking', recipeId: ID }],
    ['/menu?week=2026-10-05', { kind: 'menu' }],
    ['/compra/tiendas', { kind: 'shopping' }],
    ['/recipes', { kind: 'catalogue' }],
    ['/recipes/new', { kind: 'catalogue' }],
    ['/profile/memoria', { kind: 'profile' }],
    ['/whatsapp/conectar', { kind: 'other' }],
    [null, { kind: 'other' }],
  ])('%s', (path, expected) => {
    expect(describePage(path as string | null)).toEqual(expected)
  })
})

describe('pageContextNote', () => {
  it('names the recipe being viewed or cooked', () => {
    expect(pageContextNote({ kind: 'recipe', recipeId: ID }, 'Tzatziki')).toContain('«Tzatziki»')
    expect(pageContextNote({ kind: 'cooking', recipeId: ID }, 'Tzatziki')).toContain('modo cocina')
  })
  it('says nothing about a recipe the user cannot see', () => {
    expect(pageContextNote({ kind: 'recipe', recipeId: ID }, null)).toBeNull()
  })
  it('says nothing on pages without context', () => {
    expect(pageContextNote({ kind: 'other' }, null)).toBeNull()
  })
})

describe('withPageContext', () => {
  it('appends the note to what the model reads; no note, no change', () => {
    expect(withPageContext('¿Cuánto tarda?', 'Está viendo la receta «Tzatziki».')).toBe('¿Cuánto tarda?\n\n[Pantalla actual (no lo menciones): Está viendo la receta «Tzatziki».]')
    expect(withPageContext('Hola', null)).toBe('Hola')
  })
})

// 23-nov: «¿cuál es el siguiente paso?» → «no veo en cuál de los cinco estás».
describe('the cook mode step travels with the message', () => {
  const ID = '0b01c57b-fad2-4d81-9d56-4ba60cc689be'
  it('cookStepOf takes a sane 1-based step and drops the rest', () => {
    expect(cookStepOf({ step: 3, total: 5 })).toEqual({ step: 3, total: 5 })
    expect(cookStepOf({ step: 0, total: 5 })).toBeNull()
    expect(cookStepOf({ step: 6, total: 5 })).toBeNull()
    expect(cookStepOf({ step: '3', total: 5 })).toBeNull()
    expect(cookStepOf(null)).toBeNull()
  })
  it('the note says which step is on screen and which is next', () => {
    const note = pageContextNote({ kind: 'cooking', recipeId: ID }, 'Lentejas', { step: 3, total: 5 })!
    expect(note).toContain('el paso 3 de 5')
    expect(note).toContain('«el siguiente paso» es el 4')
    expect(pageContextNote({ kind: 'cooking', recipeId: ID }, 'Lentejas', { step: 5, total: 5 })).toContain('último')
  })
  it('without the step, the note as before', () => {
    expect(pageContextNote({ kind: 'cooking', recipeId: ID }, 'Lentejas')).not.toContain('paso')
  })
})
