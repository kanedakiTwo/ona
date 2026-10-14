/**
 * PRO-85: in Mimo's web panel, a recipe the reply mentions is a link to its
 * page. The reply text is the model's; the recipe ids come from the turn's
 * `data` (today's menu, the week, a recipe asked by name). Notes never link.
 */
import { describe, expect, it } from 'vitest'
import { linkRecipeNames, recipeRefsFrom } from '../../../web/src/lib/mimoRecipeLinks'

const day = {
  lunch: { dishes: [{ kind: 'recipe', recipeId: 'r1', recipeName: 'Lentejas estofadas' }, { kind: 'note', text: 'Pan' }] },
  dinner: { dishes: [{ kind: 'recipe', recipeId: 'r2', recipeName: 'Crema de calabaza' }] },
}

describe('recipeRefsFrom', () => {
  it("today's menu (get_todays_menu): every recipe of the day, notes out", () => {
    expect(recipeRefsFrom('menu', { dayIndex: 2, day })).toEqual([
      { id: 'r1', name: 'Lentejas estofadas' },
      { id: 'r2', name: 'Crema de calabaza' },
    ])
  })
  it('a week (days[]), once per recipe', () => {
    expect(recipeRefsFrom('menu', { days: [day, day, null] })).toHaveLength(2)
  })
  it('a recipe asked by name, and { recipeId, recipeName }', () => {
    expect(recipeRefsFrom('recipe', { id: 'r9', name: 'Paella' })).toEqual([{ id: 'r9', name: 'Paella' }])
    expect(recipeRefsFrom('text', { recipeId: 'r3', recipeName: 'Pisto' })).toEqual([{ id: 'r3', name: 'Pisto' }])
  })
  it('nothing usable → none', () => {
    expect(recipeRefsFrom('text', null)).toEqual([])
    expect(recipeRefsFrom('shopping_list', [{ id: 'x', name: 'Leche' }])).toEqual([])
  })
})

describe('linkRecipeNames', () => {
  const refs = [
    { id: 'r1', name: 'Lentejas estofadas' },
    { id: 'r2', name: 'Crema de calabaza' },
  ]
  it('a recipe name with an id becomes a link to its page (any case)', () => {
    expect(linkRecipeNames('Hoy comes lentejas estofadas y cenas Crema de calabaza.', refs)).toEqual([
      { text: 'Hoy comes ' },
      { text: 'lentejas estofadas', href: '/recipes/r1' },
      { text: ' y cenas ' },
      { text: 'Crema de calabaza', href: '/recipes/r2' },
      { text: '.' },
    ])
  })
  it('only whole words, only the first mention, text untouched without refs', () => {
    expect(linkRecipeNames('Pistones', [{ id: 'p', name: 'Pisto' }])).toEqual([{ text: 'Pistones' }])
    expect(linkRecipeNames('Pisto y más pisto', [{ id: 'p', name: 'Pisto' }])).toEqual([
      { text: 'Pisto', href: '/recipes/p' },
      { text: ' y más pisto' },
    ])
    expect(linkRecipeNames('Hola', [])).toEqual([{ text: 'Hola' }])
  })
  it('the longer name wins when one contains another', () => {
    const segs = linkRecipeNames('Tortilla de patata', [
      { id: 'a', name: 'Tortilla' },
      { id: 'b', name: 'Tortilla de patata' },
    ])
    expect(segs).toEqual([{ text: 'Tortilla de patata', href: '/recipes/b' }])
  })
})
