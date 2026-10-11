/**
 * PRO-31 — «Con lo que tengo»: 1–3 ingredients → recipes that use them.
 * Pure ranking (`rankWithWhatIHave`) + Mimo's `cook_with_what_i_have` tool.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../services/userMemoryStore.js', () => ({
  getMemoryForUser: vi.fn(async () => ({})),
}))
vi.mock('../services/scopeResolver.js', () => ({
  resolveScope: vi.fn(async (userId: string) => ({ kind: 'user', value: userId })),
  scopeWhere: vi.fn(() => ({})),
  getPrimaryHouseholdId: vi.fn(async () => null),
}))

import { compileRestrictions } from '../services/dietaryRestrictions.js'
import {
  rankWithWhatIHave,
  singularTerm,
  isBasicIngredient,
  type CandidateRecipe,
} from '../services/withWhatIHave.js'
import { skills } from '../services/assistant/skills.js'

const CALABACIN = 'ing-calabacin'
const HUEVO = 'ing-huevo'
const ing = (ingredientId: string, ingredientName: string, extra: Partial<{ optional: boolean; allergenTags: string[] }> = {}) => ({
  ingredientId,
  ingredientName,
  ...extra,
})

const tortilla: CandidateRecipe = {
  id: 'r-tortilla',
  name: 'Tortilla de calabacín',
  ingredients: [ing(HUEVO, 'Huevo'), ing(CALABACIN, 'Calabacín'), ing('i-cebolla', 'Cebolla'), ing('i-aceite', 'Aceite de oliva virgen extra'), ing('i-sal', 'Sal')],
}
const crema: CandidateRecipe = {
  id: 'r-crema',
  name: 'Crema de calabacín',
  ingredients: [ing(CALABACIN, 'Calabacín'), ing('i-puerro', 'Puerro'), ing('i-agua', 'Agua'), ing('i-pimienta', 'Pimienta negra')],
}
const revuelto: CandidateRecipe = {
  id: 'r-revuelto',
  name: 'Revuelto de setas',
  ingredients: [ing('i-huevo-campero', 'Huevos camperos'), ing('i-setas', 'Setas'), ing('i-perejil', 'Perejil', { optional: true })],
}
const rebozado: CandidateRecipe = {
  id: 'r-rebozado',
  name: 'Calabacín rebozado',
  ingredients: [ing(CALABACIN, 'Calabacín'), ing(HUEVO, 'Huevo'), ing('i-pan', 'Pan rallado', { allergenTags: ['gluten'] }), ing('i-harina', 'Harina de trigo')],
}
const lentejas: CandidateRecipe = {
  id: 'r-lentejas',
  name: 'Lentejas',
  ingredients: [ing('i-lentejas', 'Lentejas'), ing('i-zanahoria', 'Zanahoria')],
}
const all = [lentejas, crema, revuelto, rebozado, tortilla]
const noRules = compileRestrictions([])

describe('rankWithWhatIHave', () => {
  it('calabacín + huevo: recipes using both come first; unrelated recipes are out', () => {
    const hits = rankWithWhatIHave(all, [{ id: CALABACIN, name: 'Calabacín' }, { id: HUEVO, name: 'Huevo' }], noRules)
    const ids = hits.map((h) => h.recipe.id)
    expect(ids.slice(0, 2).sort()).toEqual(['r-rebozado', 'r-tortilla'])
    expect(ids).not.toContain('r-lentejas')
    expect(ids).toContain('r-crema')
    // «Huevos camperos» is another catalogue row, but it's still huevo.
    expect(ids).toContain('r-revuelto')
    expect(hits[0].uses).toEqual(['Calabacín', 'Huevo'])
  })

  it('basics (sal, aceite, agua, pimienta, harina) and optional ingredients are never missing', () => {
    const hits = rankWithWhatIHave(all, [{ id: CALABACIN, name: 'Calabacín' }, { id: HUEVO, name: 'Huevo' }], noRules)
    const by = Object.fromEntries(hits.map((h) => [h.recipe.id, h.missing]))
    expect(by['r-tortilla']).toEqual(['Cebolla'])
    expect(by['r-crema']).toEqual(['Puerro'])
    expect(by['r-rebozado']).toEqual(['Pan rallado'])
    expect(by['r-revuelto']).toEqual(['Setas'])
  })

  it('a recipe with one of the user’s allergens never shows up', () => {
    const rules = compileRestrictions(['gluten'])
    const hits = rankWithWhatIHave(all, [{ id: CALABACIN, name: 'Calabacín' }, { id: HUEVO, name: 'Huevo' }], rules)
    expect(hits.map((h) => h.recipe.id)).not.toContain('r-rebozado')
    expect(hits[0].recipe.id).toBe('r-tortilla')
  })

  it('dislikes filter too (same rules as suggest_recipes)', () => {
    const hits = rankWithWhatIHave(all, [{ name: 'calabacín' }], compileRestrictions([], ['puerro']))
    expect(hits.map((h) => h.recipe.id)).not.toContain('r-crema')
  })

  it('free-text names (Mimo) match by word, plural-tolerant, and only 3 count', () => {
    const hits = rankWithWhatIHave(all, [{ name: 'calabacines' }, { name: 'huevos' }], noRules)
    expect(hits.slice(0, 2).map((h) => h.recipe.id).sort()).toEqual(['r-rebozado', 'r-tortilla'])
    expect(singularTerm('Huevos')).toBe('huevo')
    expect(singularTerm('limones')).toBe('limon')
    expect(singularTerm('tomates')).toBe('tomate')
    expect(rankWithWhatIHave(all, [], noRules)).toEqual([])
  })

  it('basics are whole words: pimiento and salmón are not basics', () => {
    expect(isBasicIngredient('Sal gruesa')).toBe(true)
    expect(isBasicIngredient('Pimienta negra')).toBe(true)
    expect(isBasicIngredient('Pimiento rojo')).toBe(false)
    expect(isBasicIngredient('Salmón')).toBe(false)
    expect(isBasicIngredient('Aguacate')).toBe(false)
  })
})

/** Drizzle-ish mock: every chain returns itself; awaiting pops the next response. */
function makeDb(...responses: any[]) {
  const queue = [...responses]
  const node: any = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: any, reject: any) =>
          queue.length === 0 ? reject(new Error('mockDb: queue empty')) : Promise.resolve(queue.shift()).then(resolve, reject)
      }
      return () => node
    },
  })
  return node
}

describe('Mimo tool cook_with_what_i_have', () => {
  const tool = skills.find((s) => s.name === 'cook_with_what_i_have')!

  it('exists and asks for ingredients when none are given', async () => {
    expect(tool).toBeDefined()
    const r = await tool.handler({ ingredients: [] }, { userId: 'u-1', db: makeDb() })
    expect(r.summary).toMatch(/Dime que ingredientes/)
  })

  it('«tengo calabacín y huevos»: answers with the recipes using both first and what is missing', async () => {
    const rows = [
      { id: 'r-tortilla', name: 'Tortilla de calabacín', authorId: null, allergens: [] },
      { id: 'r-crema', name: 'Crema de calabacín', authorId: null, allergens: [] },
      { id: 'r-rebozado', name: 'Calabacín rebozado', authorId: null, allergens: ['gluten'] },
    ]
    const ingRows = [
      ...tortilla.ingredients.map((i) => ({ recipeId: 'r-tortilla', ...i })),
      ...crema.ingredients.map((i) => ({ recipeId: 'r-crema', ...i })),
      ...rebozado.ingredients.map((i) => ({ recipeId: 'r-rebozado', ...i })),
    ]
    const db = makeDb(
      [{ restrictions: ['gluten'] }], // users.restrictions
      rows, // visible recipes (no household → no members query)
      ingRows,
    )
    const r = await tool.handler({ ingredients: ['calabacín', 'huevos'] }, { userId: 'u-1', db })
    expect(r.data.map((h: any) => h.id)).toEqual(['r-tortilla', 'r-crema'])
    expect(r.summary).toContain('Tortilla de calabacín (usa calabacín y huevos; te faltaria Cebolla)')
    expect(r.summary).not.toContain('rebozado')
    expect(r.summary).not.toMatch(/Sal|Aceite|Agua|Pimienta/)
  })
})
