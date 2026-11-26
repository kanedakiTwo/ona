/**
 * «Ver receta» from the menu and back (apps/web/src/lib/menuReturn.ts,
 * Miguel 2026-11-05): the recipe link carries `?desde=menu`, the recipe's
 * back button reads it, and /menu reads its day from `?day=`.
 */
import { describe, expect, it } from 'vitest'
import { dayFromSearch, menuRecipeHref, recipeBackTarget } from '../../../web/src/lib/menuReturn'

describe('menuRecipeHref', () => {
  it('opens the recipe at the menu servings and marks it as opened from the menu', () => {
    expect(menuRecipeHref('r1', 4)).toBe('/recipes/r1?servings=4&desde=menu')
  })
  it('without servings only carries the origin', () => {
    expect(menuRecipeHref('r1')).toBe('/recipes/r1?desde=menu')
    expect(menuRecipeHref('r1', null)).toBe('/recipes/r1?desde=menu')
  })
})

describe('recipeBackTarget', () => {
  it('a recipe opened from the menu goes back to the menu', () => {
    expect(recipeBackTarget('?servings=4&desde=menu')).toEqual({ fromMenu: true, href: '/menu', label: 'Menú' })
  })
  it('any other recipe keeps the catalogue', () => {
    expect(recipeBackTarget('')).toEqual({ fromMenu: false, href: '/recipes', label: 'Recetas' })
    expect(recipeBackTarget('?servings=2')).toEqual({ fromMenu: false, href: '/recipes', label: 'Recetas' })
  })
})

describe('dayFromSearch', () => {
  it('reads the day index of /menu', () => {
    expect(dayFromSearch('?week=2026-11-09&day=2')).toBe(2)
    expect(dayFromSearch('?day=0')).toBe(0)
    expect(dayFromSearch('?day=6')).toBe(6)
  })
  it('ignores a missing or malformed day', () => {
    expect(dayFromSearch('')).toBeNull()
    expect(dayFromSearch('?day=7')).toBeNull()
    expect(dayFromSearch('?day=-1')).toBeNull()
    expect(dayFromSearch('?day=2x')).toBeNull()
    expect(dayFromSearch('?day=')).toBeNull()
  })
})
