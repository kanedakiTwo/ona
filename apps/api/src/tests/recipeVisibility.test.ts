/**
 * Recipe visibility: catalogue recipes are public; user recipes are visible
 * to the author and their household only (specs/recipes.md).
 */
import { describe, it, expect } from 'vitest'
import { filterVisible, canViewRecipe } from '../services/recipeVisibility.js'

describe('recipe visibility', () => {
  const rows = [
    { id: 'cat', authorId: null },
    { id: 'mine', authorId: 'u1' },
    { id: 'partner', authorId: 'u2' },
    { id: 'stranger', authorId: 'u9' },
  ]

  it('keeps catalogue + own + household recipes, drops strangers', () => {
    expect(filterVisible(rows, ['u1', 'u2']).map((r) => r.id)).toEqual(['cat', 'mine', 'partner'])
    expect(filterVisible(rows, []).map((r) => r.id)).toEqual(['cat'])
  })

  it('catalogue recipes are visible to anyone, user recipes never to anonymous viewers', async () => {
    expect(await canViewRecipe(undefined, null)).toBe(true)
    expect(await canViewRecipe(undefined, 'u1')).toBe(false)
    expect(await canViewRecipe('u1', 'u1')).toBe(true)
  })
})
