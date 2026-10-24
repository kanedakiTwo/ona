/**
 * PRO-346 — the diet filter also reads PRO-268's list: what the steps name
 * and the ingredients don't. «Lentejas guisadas» (catalogue) has vegetarian
 * ingredients but its steps say «Añadir huesos» and «añadir chorizo y
 * morcilla»; it went into Laura's vegetarian menu (hogares de prueba,
 * 2026-10-22). Until Cocina fixes it (COC-22), it isn't proposed to a
 * vegetarian household, one without pork or with the allergy its steps name.
 *
 * Run: cd apps/api && npx vitest run src/tests/stepDietFilter.test.ts
 */
import { describe, expect, it, vi } from 'vitest'
import { compileRestrictions, recipeIdsBreakingRestrictions, violatesRestrictions, type RestrictableRecipe } from '../services/dietaryRestrictions.js'
import { unlistedDietMentions } from '../services/stepDietMentions.js'
import { matchRecipes, type RecipeWithIngredients } from '../services/recipeMatcher.js'
import { seedRecipes } from '../seed/recipes.js'

vi.mock('../services/recipeVisibility.js', () => ({
  visibleAuthorIds: async (userId: string) => [userId],
  visibleRecipeWhere: () => undefined,
}))

const { loadMatchableRecipes } = await import('../services/matchableRecipes.js')

/** A recipe as the menu loader shapes it: ingredients plus what the steps name unlisted. */
function withSteps(names: string[], steps: string[]): RestrictableRecipe {
  return { ingredients: names.map((ingredientName) => ({ ingredientName })), stepMentions: unlistedDietMentions(steps, names) }
}

const blocks = (restrictions: string[], r: RestrictableRecipe) => violatesRestrictions(r, compileRestrictions(restrictions))

const LENTEJAS = seedRecipes.find((r) => r.name === 'Lentejas guisadas')!
const LENTEJAS_STEPS = [
  'Sofreír la cebolla, el pimiento y el ajo.',
  'Añadir las lentejas y cubrir de agua.',
  'Añadir huesos y pimentón de la Vera.',
  'A los 30 minutos añadir chorizo y morcilla.',
]
const LENTEJAS_INGREDIENTS = ['lentejas', 'cebolla', 'pimiento verde', 'ajo', 'pimentón de la Vera', 'aceite de oliva']

describe('steps that name meat keep the recipe out of a vegetarian menu', () => {
  it('a recipe whose steps name chorizo is not for a vegetarian household', () => {
    const r = withSteps(LENTEJAS_INGREDIENTS, LENTEJAS_STEPS)
    expect(blocks(['vegetariano'], r)).toBe(true)
    expect(blocks(['vegano'], r)).toBe(true)
    expect(blocks(['sin cerdo'], r)).toBe(true)
    expect(blocks(['halal'], r)).toBe(true)
    // The ingredients alone said it was fine (the bug).
    expect(blocks(['vegetariano'], { ingredients: r.ingredients })).toBe(false)
  })

  it('only chorizo in the steps: also out for «sin cerdo»; «sin gluten» and «pescetariano» don\'t care about pork… but the latter does about meat', () => {
    const r = withSteps(['garbanzos', 'espinacas'], ['Cuece los garbanzos.', 'Añade el chorizo en rodajas.'])
    expect(blocks(['vegetariano'], r)).toBe(true)
    expect(blocks(['sin cerdo'], r)).toBe(true)
    expect(blocks(['pescetariano'], r)).toBe(true)
    expect(blocks(['sin gluten'], r)).toBe(false)
    expect(blocks([], r)).toBe(false)
  })

  it('«huesos» alone is meat for a vegetarian, but not pork', () => {
    const r = withSteps(['garbanzos'], ['Añadir huesos al caldo.'])
    expect(blocks(['vegetariano'], r)).toBe(true)
    expect(blocks(['sin cerdo'], r)).toBe(false)
  })

  it('the allergy the steps name', () => {
    expect(blocks(['marisco'], withSteps(['arroz'], ['Saltea las gambas.']))).toBe(true)
    expect(blocks(['pescado'], withSteps(['patata'], ['Coloca la merluza encima.']))).toBe(true)
    expect(blocks(['vegetariano'], withSteps(['patata'], ['Coloca la merluza encima.']))).toBe(true)
    expect(blocks(['pescetariano'], withSteps(['patata'], ['Coloca la merluza encima.']))).toBe(false)
    expect(blocks(['sin gluten'], withSteps(['tomate'], ['Sirve con pan tostado.']))).toBe(true)
    expect(blocks(['frutos secos'], withSteps(['judías'], ['Espolvorea almendras tostadas.']))).toBe(true)
    expect(blocks(['huevo'], withSteps(['harina'], ['Monta las claras a punto de nieve.']))).toBe(true)
    expect(blocks(['sin lactosa'], withSteps(['pasta'], ['Espolvorea queso rallado.']))).toBe(true)
    expect(blocks(['sin alcohol'], withSteps(['ternera'], ['Riega con el vino.']))).toBe(true)
  })

  it('once Cocina fixes the recipe, the ingredients decide again', () => {
    // Steps without the meat: vegetarian.
    const fixed = withSteps(LENTEJAS_INGREDIENTS, LENTEJAS_STEPS.slice(0, 2))
    expect(fixed.stepMentions).toEqual([])
    expect(blocks(['vegetariano'], fixed)).toBe(false)
    // Meat listed as an ingredient: not vegetarian (by the ingredients), still fine for whoever eats pork.
    const listed = withSteps([...LENTEJAS_INGREDIENTS, 'chorizo', 'morcilla', 'hueso de jamón'], LENTEJAS_STEPS)
    expect(listed.stepMentions).toEqual([])
    expect(blocks(['vegetariano'], listed)).toBe(true)
  })

  it('the catalogue\'s «Lentejas guisadas», while uncorrected, is hidden from the vegetarian picker', () => {
    const r = { id: 'lentejas', ...withSteps(LENTEJAS.ingredients.map((i) => i.name), LENTEJAS.steps) }
    if ((r.stepMentions ?? []).length === 0) return // Cocina fixed it (COC-22): nothing to hide.
    expect(recipeIdsBreakingRestrictions([r], ['vegetariano'])).toEqual(['lentejas'])
  })
})

// ─── The menu loader carries the step mentions to the matcher ────

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

describe('loadMatchableRecipes + matchRecipes: a vegetarian household', () => {
  const recipeRow = (id: string, name: string) => ({
    id, name, authorId: null, servings: 4, course: 'main', meals: ['lunch', 'dinner'], seasons: [], tags: [], allergens: [],
  })
  const line = (recipeId: string, i: number, ingredientName: string, quantity = 100) => ({
    recipeId, ingredientId: `${recipeId}-i${i}`, quantity, unit: 'g', ingredientName, allergenTags: [], containsTags: [],
    unitWeight: null, density: null, edibleFraction: 1,
  })
  const rows = [recipeRow('r-lent', 'Lentejas guisadas'), recipeRow('r-esto', 'Lentejas estofadas')]
  const lines = ['r-lent', 'r-esto'].flatMap((id) => [
    line(id, 0, 'lentejas', 320),
    ...['cebolla', 'pimiento verde', 'zanahoria'].map((n, i) => line(id, i + 1, n)),
  ])
  const steps = [
    ...LENTEJAS_STEPS.map((text, index) => ({ recipeId: 'r-lent', index, text })),
    ...LENTEJAS_STEPS.slice(0, 2).map((text, index) => ({ recipeId: 'r-esto', index, text })),
  ]

  it('the recipe whose steps name chorizo is never proposed; the fixed one is', async () => {
    // Queries: recipes, the ficha (household, facts, persons, portrait), ingredient lines, steps.
    const pool = await loadMatchableRecipes('u-laura', makeDb(rows, [{ householdId: 'h1' }], [], [], [], lines, steps))
    expect(pool.find((r) => r.id === 'r-lent')!.stepMentions!.map((m) => m.term)).toEqual(['hueso', 'chorizo', 'morcilla'])
    expect(pool.map((r) => r.catalogAuditIssues)).toEqual([[], []])
    const opts = { meal: 'lunch' as const, season: 'autumn' as const, usedRecipeIds: new Set<string>(), favoriteRecipeIds: new Set<string>() }
    const forLaura = matchRecipes(pool as RecipeWithIngredients[], { ...opts, restrictions: ['vegetariano'] }).map((r) => r.id)
    expect(forLaura).not.toContain('r-lent')
    expect(forLaura).toContain('r-esto')
    // Without restrictions both are there.
    expect(matchRecipes(pool as RecipeWithIngredients[], { ...opts, restrictions: [] }).map((r) => r.id).sort()).toEqual(['r-esto', 'r-lent'])
  })
})
