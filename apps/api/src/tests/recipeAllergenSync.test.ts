/**
 * PRO-1118: a recipe's stored allergens are its ingredients' union; the pure
 * part of the recompute and of the Admin count. The DB path is in
 * recipeAllergenSync.smoke.ts and the route in e2e/admin-allergen-mismatch.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import { allergenTagsChanged, compareRecipeAllergens } from '../services/nutrition/recipeAllergenSync.js'

describe('allergenTagsChanged', () => {
  it('compares as sets', () => {
    expect(allergenTagsChanged(['gluten', 'sesamo'], ['sesamo', 'gluten'])).toBe(false)
    expect(allergenTagsChanged(null, [])).toBe(false)
    expect(allergenTagsChanged([], ['sesamo'])).toBe(true)
    expect(allergenTagsChanged(['sesamo'], [])).toBe(true)
  })
})

describe('compareRecipeAllergens', () => {
  const catalog = new Map<string, { allergenTags?: string[] | null }>([
    ['zaatar', { allergenTags: ['sesamo'] }],
    ['feta', { allergenTags: ['lactosa'] }],
    ['perejil', { allergenTags: [] }],
  ])

  it("the parsley salad stored without sesame differs; once stored, it doesn't", () => {
    const [ensalada, crema] = compareRecipeAllergens(
      [
        { id: 'ensalada', allergens: ['lactosa'], ingredientIds: ['perejil', 'feta', 'zaatar'] },
        { id: 'crema', allergens: ['sesamo'], ingredientIds: ['zaatar'] },
      ],
      catalog,
    )
    expect(ensalada).toEqual({ id: 'ensalada', stored: ['lactosa'], expected: ['lactosa', 'sesamo'], differs: true })
    expect(crema.differs).toBe(false)
  })

  it('a tag the ingredients no longer have also counts', () => {
    const [r] = compareRecipeAllergens([{ id: 'r', allergens: ['gluten'], ingredientIds: ['perejil'] }], catalog)
    expect(r).toMatchObject({ expected: [], differs: true })
  })

  it('order and repeats never count', () => {
    const [r] = compareRecipeAllergens(
      [{ id: 'r', allergens: ['sesamo', 'lactosa', 'sesamo'], ingredientIds: ['zaatar', 'feta'] }],
      catalog,
    )
    expect(r.differs).toBe(false)
  })
})
