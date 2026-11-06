import { describe, expect, it } from 'vitest'
import { placeCookNowRecipe } from '../services/cookNow/place.js'

const r = (name: string, extra: Record<string, unknown> = {}) => ({ kind: 'recipe' as const, recipeId: name, recipeName: name, ...extra })
const week = () => [
  { dinner: { servings: 3, dishes: [r('Lentejas', { pinnedType: 'legumbres' }), { kind: 'note' as const, text: 'pan' }] } },
  { dinner: { dishes: [r('Merluza')] }, lunch: { dishes: [r('Táper', { variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner', dishPosition: 0 } })] } },
  {}, {}, {}, {}, {},
] as any[]
const tortilla = r('Tortilla')

describe('placeCookNowRecipe', () => {
  it('replaces every dish of the slot with the new one, with the servings asked', () => {
    const out = placeCookNowRecipe(week(), { day: 0, meal: 'dinner' }, tortilla, 2, null)
    expect(out[0].dinner).toEqual({ servings: 2, dishes: [tortilla] })
  })
  it('without servings keeps no override', () => {
    expect(placeCookNowRecipe(week(), { day: 0, meal: 'dinner' }, tortilla, null, null)[0].dinner).toEqual({ dishes: [tortilla] })
  })
  it('moves the planned recipe dishes (settings kept) to the chosen day, replacing what was there', () => {
    const out = placeCookNowRecipe(week(), { day: 0, meal: 'dinner' }, tortilla, null, 1)
    expect(out[1].dinner.dishes).toEqual([r('Lentejas', { pinnedType: 'legumbres' })])
  })
  it('leftovers of the moved slot follow it', () => {
    const out = placeCookNowRecipe(week(), { day: 0, meal: 'dinner' }, tortilla, null, 3)
    expect(out[1].lunch.dishes[0].leftoverOf).toEqual({ day: 3, meal: 'dinner', dishPosition: 0 })
  })
  it('does not mutate the input', () => {
    const w = week()
    placeCookNowRecipe(w, { day: 0, meal: 'dinner' }, tortilla, null, 1)
    expect(w[0].dinner.dishes[0].recipeName).toBe('Lentejas')
  })
})
