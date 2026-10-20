/** PRO-238 — a placed dish that is already another day of the week is said in the tool's summary. */
import { describe, expect, it } from 'vitest'
import { repeatNote, sameDishElsewhere } from '../services/assistant/weekRepeats.js'

const r = (recipeId: string, recipeName: string, variant?: string) => ({ kind: 'recipe', recipeId, recipeName, ...(variant ? { variant } : {}) })
const week = (): any[] => [
  { lunch: { dishes: [r('mac', 'Macarrones con tomate')] } },
  { dinner: { dishes: [r('pe', 'Pollo empanado')] } },
  { lunch: { dishes: [r('mac', 'Macarrones con tomate', 'leftover')] } },
  {},
  { dinner: { dishes: [r('pz', 'Pizza casera')] } },
  { dinner: { dishes: [{ kind: 'note', text: 'Croquetas' }] } },
  { dinner: { dishes: [r('pe2', 'Pollo  Empanado')] } },
]

describe('sameDishElsewhere', () => {
  it('same recipe or same name (accents, case and spaces aside), never the slot itself', () => {
    expect(sameDishElsewhere(week(), '2026-10-19', 1, 'dinner', { recipeId: 'pe', name: 'Pollo empanado' })).toEqual([
      'la cena del domingo 25 de octubre',
    ])
    expect(sameDishElsewhere(week(), '2026-10-19', 3, 'lunch', { name: 'croquetas' })).toEqual(['la cena del sábado 24 de octubre'])
  })

  it('a planned leftover (táper) of the same dish is not a repeat', () => {
    expect(sameDishElsewhere(week(), '2026-10-19', 0, 'lunch', { recipeId: 'mac', name: 'Macarrones con tomate' })).toEqual([])
  })
})

describe('repeatNote', () => {
  it('one line for the model, or nothing', () => {
    expect(repeatNote(week(), '2026-10-19', 3, 'dinner', { recipeId: 'pz', name: 'Pizza casera' })).toBe(
      ' Ojo: "Pizza casera" ya esta esta semana en la cena del viernes 23 de octubre. Diselo al usuario en una frase y ofrece cambiar uno de los dos.',
    )
    expect(repeatNote(week(), '2026-10-19', 3, 'dinner', { recipeId: 'zz', name: 'Lubina al horno' })).toBe('')
  })
})
