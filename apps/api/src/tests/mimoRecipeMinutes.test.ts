/**
 * PRO-308 (Marta y Jorge, 2026-10-20): the hake and the salmon Mimo created
 * had no time, in the recipe nor in the menu, so «cenas de 15 minutos» could
 * not be respected. A recipe Mimo writes always gets its minutes: the ones it
 * gives, else estimated from the steps with the catalogue's rule.
 */
import { describe, expect, it, vi } from 'vitest'

const persisted: any[] = []
vi.mock('../services/recipePersistence.js', () => ({
  persistRecipe: vi.fn(async (input: any) => {
    persisted.push(input)
    return { ok: true, recipeId: 'r-new', warnings: [] }
  }),
}))
vi.mock('../services/recipeExtractor.js', () => ({
  extractRecipeFromImage: vi.fn(),
  matchIngredients: vi.fn(async (ings: any[]) => ({
    matched: ings.map((i, n) => ({ extractedName: i.name, ingredientId: `i-${n}`, ingredientName: i.name, quantity: i.quantity, unit: i.unit, matched: true })),
    warnings: [],
  })),
}))
vi.mock('../services/recipeUrlExtractor.js', () => ({ extractRecipeFromUrl: vi.fn() }))
vi.mock('../services/recipeHouseImage.js', () => ({ scheduleHouseImage: vi.fn() }))
vi.mock('../services/providers/anthropic.js', () => ({ AnthropicProvider: vi.fn() }))
vi.mock('../db/connection.js', () => ({ db: {} }))

import { estimateRecipeTimes, DEFAULT_ACTIVE_STEP_MINUTES } from '../services/catalogRecipeTimes.js'
import { createRecipeFromParts, normalizeRecipeParts } from '../services/recipeImport.js'
import { createDishRecipe, NEW_RECIPE_PROP } from '../services/assistant/dishRecipe.js'
import { MIMO_EVAL_CASES, mimoReplyProblems } from '../services/assistant/mimoEvalCases.js'

const MERLUZA = {
  name: 'Merluza al horno con limón',
  ingredients: [{ name: 'merluza', quantity: 400, unit: 'g' }, { name: 'limón', quantity: 1, unit: 'u' }],
  steps: [
    'Precalienta el horno a 200 °C.',
    'Pon los lomos en una fuente con aceite, ajo y rodajas de limón.',
    'Hornea 12 minutos.',
  ],
}

describe('estimateRecipeTimes (the catalogue rule, for recipes Mimo writes)', () => {
  it('no minutes given: total and hands-on from the steps', () => {
    // Preheating (the oven, no minutes: 15, goes by itself), one hands-on step
    // without minutes (5) and the oven, 12 minutes (goes by itself).
    expect(estimateRecipeTimes({}, MERLUZA.steps)).toEqual({ prepTime: 5, cookTime: 27, activeTime: 5, totalTime: 32 })
  })

  it('the minutes Mimo gives win; hands-on comes from them and the steps', () => {
    expect(estimateRecipeTimes({ prepTime: 5, cookTime: 10 }, MERLUZA.steps)).toEqual({ prepTime: 5, cookTime: 10, activeTime: 5, totalTime: 15 })
    expect(estimateRecipeTimes({ prepTime: 8 }, ['Corta 3 minutos', 'Saltea 5 minutos'])).toMatchObject({ totalTime: 8, activeTime: 8 })
  })

  it('every step goes by itself: still some hands-on time; nothing to go on: nothing', () => {
    expect(estimateRecipeTimes({}, ['Deja reposar 30 minutos'])).toEqual({ prepTime: DEFAULT_ACTIVE_STEP_MINUTES, cookTime: 25, activeTime: 5, totalTime: 30 })
    expect(estimateRecipeTimes({}, [])).toEqual({ prepTime: null, cookTime: null, activeTime: null, totalTime: null })
  })
})

describe('a recipe created by Mimo without minutes is saved with total and hands-on time', () => {
  it('create_recipe path (createRecipeFromParts)', async () => {
    persisted.length = 0
    await createRecipeFromParts(MERLUZA, 'u-1')
    expect(persisted[0]).toMatchObject({ prepTime: 5, cookTime: 27, activeTime: 5 })
    // persistRecipe stores totalTime = prepTime + cookTime when steps carry no minutes.
    expect(persisted[0].prepTime + persisted[0].cookTime).toBe(32)
  })

  it('a dish Mimo makes up for the menu (swap_meal / add_dish newRecipe), with or without its minutes', async () => {
    persisted.length = 0
    await createDishRecipe('u-1', 'salmón a la plancha', { ingredients: [{ name: 'salmón', quantity: 300, unit: 'g' }], steps: ['Haz el salmón a la plancha 4 minutos por lado.'] })
    expect(persisted[0]).toMatchObject({ prepTime: 4, cookTime: 0, activeTime: 4 })
    await createDishRecipe('u-1', 'pizza casera', { ingredients: [{ name: 'harina' }], steps: ['Amasa', 'Hornea'], prepTime: 20, cookTime: 15 })
    expect(persisted[1]).toMatchObject({ prepTime: 20, cookTime: 15 })
    expect(Object.keys(NEW_RECIPE_PROP.properties)).toEqual(expect.arrayContaining(['prepTime', 'cookTime']))
  })

  it('normalizeRecipeParts carries the estimate', () => {
    expect(normalizeRecipeParts(MERLUZA)).toMatchObject({ prepTime: 5, cookTime: 27, activeTime: 5, totalTime: 32 })
  })
})

describe('Mimo is asked for the minutes', () => {
  it('create_recipe requires prepTime and cookTime', async () => {
    const { skills } = await import('../services/assistant/skills.js')
    const create = skills.find((s) => s.name === 'create_recipe')!
    expect(create.parameters.required).toEqual(expect.arrayContaining(['prepTime', 'cookTime']))
  })

  it('eval case: a recipe created without minutes fails; with them it passes', () => {
    const c = MIMO_EVAL_CASES.find((x) => x.id === 'receta-merluza-sin-minutos')!
    expect(mimoReplyProblems(c.badReply, c)).toContain('sin-minutos')
    const input = (extra: string) => `{"name":"Merluza al horno con limón","ingredients":[],"steps":[]${extra}}`
    expect(mimoReplyProblems('Hecho:\n- Receta guardada', c, ['create_recipe'], [{ name: 'create_recipe', input: input('') }])).toContain('sin-minutos')
    expect(mimoReplyProblems('Hecho:\n- Receta guardada: 15 min', c, ['create_recipe'], [{ name: 'create_recipe', input: input(',"prepTime":5,"cookTime":10') }])).toEqual([])
    expect(mimoReplyProblems('Hecho:\n- Merluza al horno con limón: 15 min, 5 de trabajo', c)).toEqual([])
  })
})
