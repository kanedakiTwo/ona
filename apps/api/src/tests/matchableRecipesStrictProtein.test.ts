/**
 * Miguel, 2026-10-21: starters and rice/legume dishes no longer need 80 g of
 * meat, fish or egg per serving — except in the menus of a user with
 * `users.strict_protein_minimum` (today only him). The menu loader reads the
 * owner's flag and passes it to the catalogue audit.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../services/recipeVisibility.js', () => ({
  visibleAuthorIds: async (userId: string) => [userId],
  visibleRecipeWhere: () => undefined,
}))

const { loadMatchableRecipes } = await import('../services/matchableRecipes.js')

/** Drizzle-like chain whose awaited queries return `responses` in order. */
function makeDb(...responses: any[]) {
  const queue = [...responses]
  const node: any = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve: any, reject?: any) =>
            queue.length === 0 ? Promise.reject(new Error('mockDb: queue empty')) : Promise.resolve(queue.shift()).then(resolve, reject)
        }
        return () => node
      },
    },
  )
  return node
}

const garbanzos = { id: 'r-g', name: 'Garbanzos con espinacas y huevo', authorId: null, servings: 4, course: 'main', meals: ['lunch', 'dinner'], seasons: [] }
const lines = [
  { recipeId: 'r-g', ingredientId: 'i1', quantity: 667, unit: 'g', ingredientName: 'garbanzos cocidos', allergenTags: [], containsTags: [], unitWeight: null, density: null, edibleFraction: 1 },
  { recipeId: 'r-g', ingredientId: 'i2', quantity: 6, unit: 'u', ingredientName: 'huevo', allergenTags: ['huevo'], containsTags: [], unitWeight: 50, density: null, edibleFraction: 1 },
  { recipeId: 'r-g', ingredientId: 'i3', quantity: 133, unit: 'g', ingredientName: 'espinacas', allergenTags: [], containsTags: [], unitWeight: null, density: null, edibleFraction: 1 },
]
const steps = [{ recipeId: 'r-g', n: 6 }]

describe('loadMatchableRecipes — the menu owner decides the protein minimum', () => {
  it('for everyone, garbanzos with 75 g of egg per serving can go in the menu', async () => {
    const [r] = await loadMatchableRecipes('u-1', makeDb([garbanzos], [{ strict: false }], lines, steps))
    expect(r.catalogAuditIssues).toEqual([])
  })

  it('a user with strict_protein_minimum does not get it', async () => {
    const [r] = await loadMatchableRecipes('u-miguel', makeDb([garbanzos], [{ strict: true }], lines, steps))
    expect(r.catalogAuditIssues).toEqual(['proteina_fuera_de_rango'])
  })

  it('no user row (deleted account mid-request) means the default', async () => {
    const [r] = await loadMatchableRecipes('u-x', makeDb([garbanzos], [], lines, steps))
    expect(r.catalogAuditIssues).toEqual([])
  })
})
