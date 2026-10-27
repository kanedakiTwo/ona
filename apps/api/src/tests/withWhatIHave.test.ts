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
      [], // this week's menu (vetoes): none
      [{ restrictions: ['gluten'] }], // users.restrictions
      rows, // visible recipes (no household → no members query)
      ingRows,
      [], // steps
    )
    const r = await tool.handler({ ingredients: ['calabacín', 'huevos'] }, { userId: 'u-1', db })
    expect(r.data.recipes.map((h: any) => h.id)).toEqual(['r-tortilla', 'r-crema'])
    expect(r.summary).toContain('Tortilla de calabacín (usa calabacín y huevos; te faltaria Cebolla)')
    expect(r.summary).not.toContain('rebozado')
    expect(r.summary).not.toMatch(/Sal|Aceite|Agua|Pimienta/)
  })

  it('PRO-346: a vegetarian household never gets a recipe whose steps add chorizo', async () => {
    const rows = [
      { id: 'r-tortilla', name: 'Tortilla de calabacín', authorId: null, allergens: [] },
      { id: 'r-crema', name: 'Crema de calabacín', authorId: null, allergens: [] },
    ]
    const ingRows = [
      ...tortilla.ingredients.map((i) => ({ recipeId: 'r-tortilla', ...i })),
      ...crema.ingredients.map((i) => ({ recipeId: 'r-crema', ...i })),
    ]
    const steps = [{ recipeId: 'r-crema', index: 0, text: 'Al final, añadir chorizo en daditos.' }]
    const db = makeDb([], [{ restrictions: ['vegetariano'] }], rows, ingRows, steps)
    const r = await tool.handler({ ingredients: ['calabacín'] }, { userId: 'u-1', db })
    expect(r.data.recipes.map((h: any) => h.id)).toEqual(['r-tortilla'])
  })
})

/** Like makeDb, but records every chained call (`values`, `set`…) so writes can be checked. */
function recordingDb(...responses: any[]) {
  const queue = [...responses]
  const calls: Array<{ method: string; args: any[] }> = []
  const node: any = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: any, reject: any) =>
          queue.length === 0 ? reject(new Error('mockDb: queue empty')) : Promise.resolve(queue.shift()).then(resolve, reject)
      }
      return (...args: any[]) => {
        calls.push({ method: String(prop), args })
        return node
      }
    },
  })
  return { db: node, calls }
}

// PRO-222 (D-069): «¿Qué hago hoy con lo que tengo?»
describe('«¿Qué hago hoy con lo que tengo?» (PRO-222)', () => {
  const tool = skills.find((s) => s.name === 'cook_with_what_i_have')!
  const POLLO = 'ing-pollo'
  const ARROZ = 'ing-arroz'
  const recipe = (id: string, name: string, totalTime: number, ings: Array<[string, string, string[]?]>, allergens: string[] = []) => ({
    row: { id, name, authorId: null, allergens, totalTime },
    ings: ings.map(([ingredientId, ingredientName, allergenTags]) => ({ recipeId: id, ingredientId, ingredientName, optional: false, allergenTags: allergenTags ?? [] })),
  })
  const catalog = [
    recipe('r-arroz-pollo', 'Arroz con pollo y calabacín', 45, [[ARROZ, 'Arroz'], [POLLO, 'Pollo'], [CALABACIN, 'Calabacín'], ['i-cebolla', 'Cebolla']]),
    recipe('r-salteado', 'Salteado de pollo y calabacín', 20, [[POLLO, 'Pechuga de pollo'], [CALABACIN, 'Calabacín'], ['i-soja', 'Salsa de soja sin gluten']]),
    recipe('r-risotto', 'Risotto de calabacín', 35, [[ARROZ, 'Arroz'], [CALABACIN, 'Calabacín'], ['i-parmesano', 'Queso parmesano']]),
    // Uses all three, but has gluten: never for a celiac household.
    recipe('r-empanada', 'Empanada de pollo, calabacín y arroz', 60, [[POLLO, 'Pollo'], [CALABACIN, 'Calabacín'], [ARROZ, 'Arroz'], ['i-harina', 'Masa de empanada', ['gluten']]], ['gluten']),
    // Uses two, but vetoed this week.
    recipe('r-vetada', 'Pollo al curry con arroz', 30, [[POLLO, 'Pollo'], [ARROZ, 'Arroz'], ['i-curry', 'Curry']]),
    // Uses only one.
    recipe('r-crema', 'Crema de calabacín', 25, [[CALABACIN, 'Calabacín'], ['i-puerro', 'Puerro']]),
  ]
  const celiacDb = () =>
    makeDb(
      [{ bannedRecipeIds: ['r-vetada'], days: [], locked: {} }], // this week's menu
      [{ restrictions: ['sin gluten'] }], // a celiac household
      catalog.map((c) => c.row),
      catalog.flatMap((c) => c.ings),
      [], // steps
    )

  it('«pollo, calabacín, arroz» for a celiac household: 3 recipes using at least two, none with gluten, none vetoed', async () => {
    const r = await tool.handler({ ingredients: ['pollo', 'calabacín', 'arroz'] }, { userId: 'u-1', db: celiacDb() })
    const ids = r.data.recipes.map((h: any) => h.id)
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe('r-arroz-pollo') // uses all three
    expect([...ids].sort()).toEqual(['r-arroz-pollo', 'r-risotto', 'r-salteado'])
    for (const h of r.data.recipes) expect(h.uses.length).toBeGreaterThanOrEqual(2)
    expect(ids).not.toContain('r-empanada')
    expect(ids).not.toContain('r-vetada')
    // Each one with its time and what is missing.
    expect(r.summary).toContain('Arroz con pollo y calabacín (45 min; usa pollo, calabacín y arroz; te faltaria Cebolla)')
    expect(r.summary).toContain('Salteado de pollo y calabacín (20 min;')
  })

  it('from a fridge photo it first lists what it saw, then proposes', async () => {
    const r = await tool.handler({ ingredients: ['pollo', 'calabacín', 'arroz'], fromPhoto: true }, { userId: 'u-1', db: celiacDb() })
    expect(r.data.seen).toEqual(['pollo', 'calabacín', 'arroz'])
    expect(r.summary.startsWith('En la foto he visto: pollo, calabacín y arroz. Si me he equivocado en algo, dimelo')).toBe(true)
    expect(r.summary.indexOf('En la foto he visto')).toBeLessThan(r.summary.indexOf('Arroz con pollo'))
  })

  it('picking one puts it in the day, even without a menu for the week', async () => {
    const { db, calls } = recordingDb(
      [{ id: 'r-salteado', name: 'Salteado de pollo y calabacín' }], // the recipe (visible to the user)
      [], // no menu this week
      [
        {
          id: 'm-new',
          days: Array.from({ length: 7 }, (_, i) => (i === 0 ? { dinner: { dishes: [{ kind: 'recipe', recipeId: 'r-salteado', recipeName: 'Salteado de pollo y calabacín' }] } } : {})),
        },
      ], // insert … returning
    )
    const r = await tool.handler({ pickRecipeId: 'r-salteado', day: '2026-10-19', meal: 'dinner' }, { userId: 'u-1', db })
    expect(r.summary).toMatch(/^Hecho: "Salteado de pollo y calabacín" en la cena del lunes 19/)
    const inserted = calls.find((c) => c.method === 'values')!.args[0]
    expect(inserted.weekStart).toBe('2026-10-19')
    expect(inserted.days[0].dinner.dishes).toEqual([{ kind: 'recipe', recipeId: 'r-salteado', recipeName: 'Salteado de pollo y calabacín' }])
    expect(r.data.change).toMatchObject({ date: '2026-10-19', meal: 'dinner', dish: 'Salteado de pollo y calabacín' })
  })

  it('picking one with a menu replaces that meal; a vetoed recipe is refused', async () => {
    const days = Array.from({ length: 7 }, () => ({ lunch: { dishes: [{ kind: 'recipe', recipeId: 'r-x', recipeName: 'Lentejas' }] } }))
    const { db, calls } = recordingDb(
      [{ id: 'r-risotto', name: 'Risotto de calabacín' }],
      [{ id: 'm-1', days, bannedRecipeIds: [], locked: {} }],
      [{ id: 'm-1', days: days.map((d, i) => (i === 1 ? { lunch: { dishes: [{ kind: 'recipe', recipeId: 'r-risotto', recipeName: 'Risotto de calabacín' }] } } : d)) }],
    )
    const r = await tool.handler({ pickRecipeId: 'r-risotto', day: '2026-10-20', meal: 'lunch' }, { userId: 'u-1', db })
    expect(r.summary).toMatch(/^Hecho: "Risotto de calabacín" en la comida del martes 20/)
    const set = calls.find((c) => c.method === 'set')!.args[0]
    expect(set.days[1].lunch.dishes[0].recipeId).toBe('r-risotto')

    const vetoed = recordingDb([{ id: 'r-vetada', name: 'Pollo al curry con arroz' }], [{ id: 'm-1', days, bannedRecipeIds: ['r-vetada'], locked: {} }])
    const no = await tool.handler({ pickRecipeId: 'r-vetada', day: '2026-10-20', meal: 'lunch' }, { userId: 'u-1', db: vetoed.db })
    expect(no.data).toBeNull()
    expect(no.summary).toMatch(/vetada/)
  })
})
