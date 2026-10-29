/**
 * PRO-373 — bases de batch cooking (specs/recipes.md, shopping.md,
 * catalog-import.md). A base (sofrito, verduras asadas…) is cooked one day
 * and used by several dishes of the week (`recipe_bases`):
 *   - the shopping list adds its ingredients once, for the servings every
 *     dish that uses it adds up to;
 *   - the menu never picks a base as a dish;
 *   - Cocina's import resolves `bases` by name (catalogue or same batch) and
 *     rejects the recipe whose base doesn't exist.
 *
 * Run: cd apps/api && npx vitest run src/tests/recipeBases.test.ts
 */
import { describe, expect, it, vi } from 'vitest'
import { cocinaRecipeSchema, checkCocinaBatch, isBaseRecipe, type DayMenu } from '@ona/shared'

vi.mock('../services/recipeVisibility.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/recipeVisibility.js')>()),
  visibleAuthorIds: async (userId: string) => [userId],
  visibleRecipeWhere: () => undefined,
}))

const { generateShoppingList, withBaseServings } = await import('../services/shoppingList.js')
const { buildRandomMenu, defaultTemplate } = await import('../services/menuGenerator.js')
const { loadMatchableRecipes } = await import('../services/matchableRecipes.js')
const { loadRecipeBaseUses } = await import('../services/recipeBases.js')
const { basesFirst, draftsFromCocinaJson, importCatalogBatch } = await import('../services/catalogImport.js')
type CatalogImportDeps = import('../services/catalogImport.js').CatalogImportDeps
type CatalogDraftInput = import('../services/catalogImport.js').CatalogDraftInput
type PersistDraftInput = import('../services/catalogImport.js').PersistDraftInput
type RecipeWithCourse = import('../services/matchableRecipes.js').RecipeWithCourse

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

// ─── Shopping list ──────────────────────────────────────────────

describe('withBaseServings', () => {
  it('adds each dish\'s share of the base: servingsUsed × diners / dish servings', () => {
    const diners = new Map([['lentejas', 2], ['arroz', 2]])
    const servings = new Map([['lentejas', 4], ['arroz', 4], ['sofrito', 4]])
    const links = [
      { recipeId: 'lentejas', baseRecipeId: 'sofrito', servingsUsed: 2 },
      { recipeId: 'arroz', baseRecipeId: 'sofrito', servingsUsed: 2 },
    ]
    const out = withBaseServings(diners, links, servings)
    expect(out.get('sofrito')).toBe(2)
    expect(out.get('lentejas')).toBe(2)
    expect(diners.has('sofrito')).toBe(false)
  })

  it('follows a base inside a base, and ignores dishes that aren\'t on the menu', () => {
    const out = withBaseServings(
      new Map([['dish', 4]]),
      [
        { recipeId: 'dish', baseRecipeId: 'salsa', servingsUsed: 4 },
        { recipeId: 'salsa', baseRecipeId: 'sofrito', servingsUsed: 1 },
        { recipeId: 'other', baseRecipeId: 'sofrito', servingsUsed: 8 },
      ],
      new Map([['dish', 4], ['salsa', 4], ['sofrito', 4], ['other', 4]]),
    )
    expect(out.get('salsa')).toBe(4)
    expect(out.get('sofrito')).toBe(1)
    expect(out.has('other')).toBe(false)
  })
})

describe('generateShoppingList with two dishes that use the same base', () => {
  const dish = (recipeId: string) => ({ dishes: [{ kind: 'recipe', recipeId }] })
  const week = [{ lunch: dish('lentejas') }, { dinner: dish('arroz') }] as unknown as DayMenu[]
  const line = (recipeId: string, ingredientId: string, ingredientName: string, quantity: number) => ({
    recipeId, recipeIngredientId: `${recipeId}-${ingredientId}`, ingredientId, quantity, unit: 'g', optional: false,
    ingredientName, aisle: 'produce', density: null, unitWeight: null, note: null,
  })

  it('buys the base\'s ingredients once, scaled to the servings both dishes use', async () => {
    // Queries: recipe_bases of the menu's dishes, of the bases (none), the recipes, their ingredient lines.
    const db = makeDb(
      [
        { recipeId: 'lentejas', baseRecipeId: 'sofrito', servingsUsed: 2 },
        { recipeId: 'arroz', baseRecipeId: 'sofrito', servingsUsed: 2 },
      ],
      [],
      [
        { id: 'lentejas', name: 'Lentejas con sofrito', servings: 4 },
        { id: 'arroz', name: 'Arroz con sofrito', servings: 4 },
        { id: 'sofrito', name: 'Sofrito', servings: 4 },
      ],
      [
        line('lentejas', 'i-lent', 'lentejas', 400),
        line('arroz', 'i-arroz', 'arroz', 400),
        line('sofrito', 'i-tom', 'tomate', 400),
        line('sofrito', 'i-ceb', 'cebolla', 200),
      ],
    )
    const items = await generateShoppingList(week, 2, db)
    const byName = (n: string) => items.filter((i) => i.name === n)
    // Each dish for 2 of its 4 → 2 servings of sofrito each… 1 + 1 = 2 of 4: half the sofrito, once.
    expect(byName('tomate')).toHaveLength(1)
    expect(byName('tomate')[0]).toMatchObject({ quantity: 200, unit: 'g', bases: ['Sofrito'] })
    expect(byName('cebolla')[0]).toMatchObject({ quantity: 100, unit: 'g', bases: ['Sofrito'] })
    // The dishes themselves, as always, and not named as a base.
    expect(byName('lentejas')[0]).toMatchObject({ quantity: 200 })
    expect(byName('lentejas')[0].bases).toBeUndefined()
    expect(byName('arroz')[0]).toMatchObject({ quantity: 200 })
  })

  it('no base links: the list is what it was', async () => {
    const db = makeDb([], [{ id: 'lentejas', name: 'Lentejas', servings: 4 }], [line('lentejas', 'i-lent', 'lentejas', 400)])
    const items = await generateShoppingList([{ lunch: dish('lentejas') }] as unknown as DayMenu[], 2, db)
    expect(items.map((i) => [i.name, i.quantity])).toEqual([['lentejas', 200]])
  })
})

// ─── Menu generator ─────────────────────────────────────────────

describe('the menu never picks a base as a dish', () => {
  const recipe = (id: string, name: string, ings: string[], tags: string[] = []): RecipeWithCourse => ({
    id,
    name,
    meals: ['lunch', 'dinner'],
    seasons: [],
    frequency: null,
    tags,
    allergens: [],
    course: null,
    ingredients: ings.map((n, j) => ({ ingredientId: `${id}-${j}`, ingredientName: n, quantity: 100, unit: 'g', allergenTags: [] })),
  })

  it('isBaseRecipe reads the `base` tag (public or internal)', () => {
    expect(isBaseRecipe({ tags: ['base'] })).toBe(true)
    expect(isBaseRecipe({ tags: [], internalTags: ['base'] })).toBe(true)
    expect(isBaseRecipe({ tags: ['batch-cooking'] })).toBe(false)
  })

  it('buildRandomMenu: over many weeks, no slot ever holds a base', () => {
    const pool = [
      recipe('b1', 'Sofrito', ['tomate', 'cebolla'], ['base']),
      recipe('b2', 'Verduras asadas', ['calabacín', 'berenjena'], ['base']),
      recipe('b3', 'Garbanzos aliñados', ['garbanzos'], ['base', 'legumbres']),
      recipe('d1', 'Lentejas estofadas', ['lentejas', 'zanahoria']),
      recipe('d2', 'Pollo al ajillo', ['pollo', 'ajo']),
      recipe('d3', 'Merluza en salsa verde', ['merluza', 'perejil']),
      recipe('d4', 'Tortilla de patatas', ['huevos', 'patata']),
    ]
    const picked = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const { days } = buildRandomMenu(defaultTemplate(), pool, 'autumn', [], new Set(), {})
      for (const d of days) for (const slot of Object.values(d)) for (const dish of (slot as any)?.dishes ?? []) if (dish.recipeId) picked.add(dish.recipeId)
    }
    expect(picked.size).toBeGreaterThan(0)
    expect([...picked].filter((id) => id.startsWith('b'))).toEqual([])
  })

  it('loadMatchableRecipes leaves bases out of every automatic pick', async () => {
    const row = (id: string, name: string, tags: string[]) => ({ id, name, authorId: null, servings: 4, course: 'main', meals: ['lunch', 'dinner'], seasons: [], tags, allergens: [] })
    // Queries: recipes, the ficha (household, facts, persons, portrait), ingredient lines, steps.
    const pool = await loadMatchableRecipes(
      'u-1',
      makeDb([row('b1', 'Sofrito', ['base']), row('d1', 'Lentejas con sofrito', [])], [{ householdId: 'h1' }], [], [], [], [], []),
    )
    expect(pool.map((r) => r.id)).toEqual(['d1'])
  })
})

// ─── Recipe page ────────────────────────────────────────────────

describe('loadRecipeBaseUses: «Usa: Sofrito (2 raciones)»', () => {
  it('lists the bases the reader may open; a draft base only for an admin', async () => {
    const rows = [
      { id: 'b2', name: 'Verduras asadas', authorId: null, status: 'draft', servings: 1 },
      { id: 'b1', name: 'Sofrito', authorId: null, status: 'published', servings: 2 },
    ]
    expect(await loadRecipeBaseUses('d1', { userId: 'u-1' }, makeDb(rows))).toEqual([{ id: 'b1', name: 'Sofrito', servings: 2 }])
    expect((await loadRecipeBaseUses('d1', { userId: 'u-1', isAdmin: true }, makeDb(rows))).map((b) => b.name)).toEqual(['Sofrito', 'Verduras asadas'])
  })
})

// ─── Cocina's import ────────────────────────────────────────────

const SOFRITO: CatalogDraftInput = {
  name: 'Sofrito de tomate',
  servings: 4,
  tags: ['base'],
  ingredients: [
    { name: 'tomate', quantity: 800, unit: 'g' },
    { name: 'cebolla', quantity: 300, unit: 'g' },
  ],
  sourceSteps: ['Pochar la cebolla y añadir el tomate.'],
  source: { origin: 'cocina' },
}
const dishUsing = (name: string, bases: Array<{ name: string; servings: number }>, servings = 4): CatalogDraftInput => ({
  name,
  servings,
  ingredients: [
    { name: 'lentejas', quantity: 300, unit: 'g' },
    { name: 'zanahoria', quantity: 100, unit: 'g' },
  ],
  sourceSteps: ['Cocer las lentejas con la zanahoria y el sofrito.'],
  source: { origin: 'cocina' },
  bases,
})

function fakeDeps(catalog: Array<{ id: string; name: string }> = []) {
  const saved: PersistDraftInput[] = []
  const rewrites: string[] = []
  const deps: CatalogImportDeps = {
    catalogNames: async () => catalog.map((c) => c.name),
    rewrite: async (d) => {
      rewrites.push(d.name)
      return {
        steps: [{ text: 'Paso de la casa con todo.', ingredientRefs: [0, 1] }],
        meals: ['lunch'], seasons: ['autumn'], course: 'main', dishType: 'guiso', protein: 'legumbre',
        techniques: [], cuisine: null, activeTime: 10, totalTime: 30, difficulty: 'easy', allergenDoubt: false,
      }
    },
    matchIngredients: async (_n, ings) => ings.map((i, k) => ({ ingredientId: `ing-${k}`, name: i.name, quantity: i.quantity, unit: i.unit as any })),
    persistDraft: async (input) => {
      saved.push(input)
      return { ok: true, recipeId: `new-${saved.length}` }
    },
    findCatalogRecipe: async (name) => catalog.find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) ?? null,
  }
  return { deps, saved, rewrites }
}

describe('import: `bases` resolved by name', () => {
  it('the schema accepts `bases: [{ name, servings }]` and says what is wrong in one', () => {
    const ok = cocinaRecipeSchema.safeParse({ name: 'Lentejas', ingredients: [{ name: 'lentejas', qty: 300, unit: 'g' }], steps: ['Cocer.'], bases: [{ name: 'Sofrito', servings: 2 }] })
    expect(ok.success).toBe(true)
    const bad = checkCocinaBatch([{ name: 'Lentejas', ingredients: [{ name: 'lentejas', qty: 300, unit: 'g' }], steps: ['Cocer.'], bases: [{ name: 'Sofrito' }] }])
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.problems[0]).toBe('Receta 1 («Lentejas»), base 1 («Sofrito»): faltan las raciones (servings).')
  })

  it('draftsFromCocinaJson carries the bases', () => {
    const [d] = draftsFromCocinaJson([{ name: 'Lentejas', ingredients: [{ name: 'lentejas', qty: 300, unit: 'g' }], steps: ['Cocer.'], bases: [{ name: 'Sofrito', servings: 2 }] }], { origin: 'cocina' })
    expect(d.bases).toEqual([{ name: 'Sofrito', servings: 2 }])
  })

  it('resolves a base of the catalogue (accents and case aside) and scales its servings to the house\'s 4', async () => {
    const { deps, saved } = fakeDeps([{ id: 'cat-sofrito', name: 'Sofrito' }])
    const [out] = await importCatalogBatch([dishUsing('Lentejas con sofrito', [{ name: 'sofrito', servings: 1 }], 2)], 't', deps)
    expect(out.status).toBe('draft')
    expect(saved[0].bases).toEqual([{ baseRecipeId: 'cat-sofrito', servingsUsed: 2 }])
  })

  it('resolves a base of the same batch, even when the file lists it after the dish', async () => {
    const { deps, saved } = fakeDeps()
    const dish = dishUsing('Lentejas con sofrito', [{ name: 'Sofrito de tomate', servings: 2 }])
    expect(basesFirst([dish, SOFRITO]).map((d) => d.name)).toEqual(['Sofrito de tomate', 'Lentejas con sofrito'])
    const out = await importCatalogBatch([dish, SOFRITO], 't', deps)
    expect(out.map((o) => [o.name, o.status])).toEqual([['Sofrito de tomate', 'draft'], ['Lentejas con sofrito', 'draft']])
    expect(saved[0].tags).toContain('base')
    expect(saved[1].bases).toEqual([{ baseRecipeId: 'new-1', servingsUsed: 2 }])
  })

  it('rejects the recipe whose base doesn\'t exist, with its reason, before paying for any AI', async () => {
    const { deps, saved, rewrites } = fakeDeps([{ id: 'cat-sofrito', name: 'Sofrito' }])
    const out = await importCatalogBatch(
      [dishUsing('Lentejas con ajada', [{ name: 'Sofrito', servings: 2 }, { name: 'Ajada gallega', servings: 1 }]), dishUsing('Garbanzos con sofrito', [{ name: 'Sofrito', servings: 2 }])],
      't',
      deps,
    )
    expect(out[0]).toMatchObject({ status: 'rejected', reason: 'bases', detail: 'sin la base en el catálogo ni en la tanda: Ajada gallega' })
    expect(rewrites).not.toContain('Lentejas con ajada')
    // One failure never stops the rest.
    expect(out[1].status).toBe('draft')
    expect(saved.map((s) => s.name)).toEqual(['Garbanzos con sofrito'])
  })
})
