/**
 * «Cocinar ahora» (specs/cook-now.md): the cook mode link carries the menu
 * slot it cooks, and cook mode reads it back (apps/web/src/lib/cookHref.ts).
 */
import { describe, expect, it } from 'vitest'
import { cookHref, menuContextFromSearch } from '../../../web/src/lib/cookHref'
import { menuDiners } from '../../../web/src/lib/menuDiners'

describe('cookHref', () => {
  it('without menu context', () => expect(cookHref('r1', 2)).toBe('/recipes/r1/cook?servings=2'))
  it('with menu context', () => expect(cookHref('r1', 4, { menuId: 'm1', day: 3, meal: 'dinner' })).toBe('/recipes/r1/cook?servings=4&menu=m1&day=3&meal=dinner'))
})

describe('menuContextFromSearch', () => {
  it('reads it back, or null when incomplete or odd', () => {
    expect(menuContextFromSearch('?servings=4&menu=m1&day=3&meal=dinner')).toEqual({ menuId: 'm1', day: 3, meal: 'dinner' })
    expect(menuContextFromSearch('?servings=4&menu=m1')).toBeNull()
    expect(menuContextFromSearch('?menu=m1&day=9&meal=dinner')).toBeNull()
    expect(menuContextFromSearch('?menu=m1&day=1&meal=cena')).toBeNull()
  })
})

describe('menuDiners', () => {
  it('counts a child as one person, like the menu', () => {
    expect(menuDiners({ adults: 2, kidsCount: 2 })).toBe(4)
    expect(menuDiners({ adults: 1, kidsCount: 0 })).toBe(1)
    expect(menuDiners({})).toBe(2)
  })
})
