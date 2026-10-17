/**
 * Pure-logic tests for the recipe matcher. The matcher is the single
 * choke-point for every "pick a recipe for this slot" code path (whole-
 * week generation, single-slot regenerate, manual add, leftover clone).
 * Bugs here propagate everywhere, so changes get tests first.
 *
 * TDD note (PR 5): the bannedRecipeIds + pinnedType filters land here.
 * These tests pin the new contract; the matcher implementation follows.
 */
import { describe, expect, it } from 'vitest'
import {
  matchRecipes,
  type MatcherOptions,
  type RecipeWithIngredients,
} from '../services/recipeMatcher.js'

// Fixture pool. Every recipe matches the baseline `lunch` + `spring`
// query so each test can vary only the predicate it exercises.
const RECIPES: RecipeWithIngredients[] = [
  {
    id: 'r1',
    name: 'Lentejas con chorizo',
    meals: ['lunch', 'dinner'],
    seasons: ['spring', 'autumn', 'winter'],
    tags: ['legumbres', 'mediterraneo'],
    ingredients: [{ ingredientId: 'i1', ingredientName: 'lentejas', quantity: 200, unit: 'g' }],
  },
  {
    id: 'r2',
    name: 'Crema de calabacín',
    meals: ['lunch', 'dinner'],
    seasons: ['spring', 'summer'],
    tags: ['cremas', 'ligero'],
    ingredients: [{ ingredientId: 'i2', ingredientName: 'calabacín', quantity: 400, unit: 'g' }],
  },
  {
    id: 'r3',
    name: 'Pizza margarita',
    meals: ['lunch', 'dinner'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    tags: ['pizza', 'mediterraneo'],
    ingredients: [{ ingredientId: 'i3', ingredientName: 'masa', quantity: 250, unit: 'g' }],
  },
]

const baseOptions: MatcherOptions = {
  meal: 'lunch',
  season: 'spring',
  usedRecipeIds: new Set(),
  restrictions: [],
  favoriteRecipeIds: new Set(),
}

describe('matchRecipes: pinnedType', () => {
  it('only returns recipes whose `tags` include the pinned type', () => {
    const out = matchRecipes(RECIPES, {
      ...baseOptions,
      pinnedType: 'cremas',
    })
    expect(out.map((r) => r.id)).toEqual(['r2'])
  })

  it('returns the empty pool when no recipe carries the pinned tag', () => {
    const out = matchRecipes(RECIPES, {
      ...baseOptions,
      pinnedType: 'parrilla', // none of the fixture recipes carries this
    })
    expect(out).toEqual([])
  })

  it('treats a null pinnedType as a no-op (same as absent)', () => {
    const out = matchRecipes(RECIPES, {
      ...baseOptions,
      pinnedType: null,
    })
    expect(out.map((r) => r.id).sort()).toEqual(['r1', 'r2', 'r3'])
  })

  it('combines with bannedRecipeIds — pinned crema that is also banned still falls out', () => {
    const out = matchRecipes(RECIPES, {
      ...baseOptions,
      pinnedType: 'cremas',
      bannedRecipeIds: new Set(['r2']),
    })
    expect(out).toEqual([])
  })

  it('combines with the meal-type filter — pinning "cremas" on a slot that excludes the candidate by meal returns empty', () => {
    // Pretend r2 only matches dinner (not lunch). The slot wants lunch.
    const recipes = [{ ...RECIPES[1], meals: ['dinner'] }, RECIPES[0], RECIPES[2]]
    const out = matchRecipes(recipes, {
      ...baseOptions,
      pinnedType: 'cremas',
    })
    expect(out).toEqual([])
  })
})

describe('matchRecipes: availableEquipment (user_memories.equipment)', () => {
  const oven = {
    id: 'rx',
    name: 'Pollo al horno',
    meals: ['lunch', 'dinner'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    tags: [],
    equipment: ['horno'],
    ingredients: [{ ingredientId: 'i', ingredientName: 'pollo', quantity: 1, unit: 'u' }],
  }
  const stove = { ...oven, id: 'ry', name: 'Estofado', equipment: ['olla express'] }
  const noeq = { ...oven, id: 'rz', name: 'Ensalada', equipment: [] }

  it('excludes recipes whose required equipment is not in the user-owned set', () => {
    const out = matchRecipes([oven, stove, noeq], {
      ...baseOptions,
      availableEquipment: new Set(['horno']), // user has oven, no pressure cooker
    })
    expect(out.map((r) => r.id).sort()).toEqual(['rx', 'rz'])
  })

  it('is accent-insensitive — "Olla Exprés" set matches "olla express" recipe', () => {
    const out = matchRecipes([stove], {
      ...baseOptions,
      availableEquipment: new Set(['olla express']), // already normalised
    })
    expect(out.map((r) => r.id)).toEqual(['ry'])
  })

  it('treats empty/undefined recipe.equipment as no requirement', () => {
    const out = matchRecipes([noeq], { ...baseOptions, availableEquipment: new Set(['horno']) })
    expect(out.map((r) => r.id)).toEqual(['rz'])
  })

  it('absent or empty availableEquipment is a no-op (user hasn\'t completed onboarding)', () => {
    const out = matchRecipes([oven, stove, noeq], baseOptions)
    expect(out.length).toBe(3)
  })
})

describe('matchRecipes: time budget (user_memories.time_available, PRO-138)', () => {
  const base = {
    id: 'q1',
    name: 'Tostada',
    meals: ['breakfast', 'lunch'],
    seasons: ['spring'],
    tags: [],
    ingredients: [],
  }
  const ids = (out: Array<{ id: string }>) => out.map((r) => r.id).sort()

  it('total mode: 20 min of prep but 120 in total does not fit in 30', () => {
    const stew = { ...base, id: 'stew', prepTime: 20, totalTime: 120 }
    expect(matchRecipes([stew], { ...baseOptions, timeBudget: { mode: 'total', minutes: 30 } })).toHaveLength(0)
  })

  it('total mode without totalTime uses prep + cook', () => {
    const a = { ...base, id: 'a', prepTime: 10, cookTime: 15 }
    const b = { ...base, id: 'b', prepTime: 10, cookTime: 40 }
    expect(ids(matchRecipes([a, b], { ...baseOptions, timeBudget: { mode: 'total', minutes: 30 } }))).toEqual(['a'])
  })

  it('work mode: 15 min of work and 200 in total fits in 20', () => {
    const cocido = { ...base, id: 'cocido', prepTime: 20, activeTime: 15, totalTime: 200 }
    expect(ids(matchRecipes([cocido], { ...baseOptions, timeBudget: { mode: 'activo', minutes: 20 } }))).toEqual(['cocido'])
  })

  it('work mode without activeTime uses prepTime', () => {
    const a = { ...base, id: 'a', prepTime: 15, totalTime: 90 }
    const b = { ...base, id: 'b', prepTime: 35, totalTime: 50 }
    expect(ids(matchRecipes([a, b], { ...baseOptions, timeBudget: { mode: 'activo', minutes: 20 } }))).toEqual(['a'])
  })

  it('a recipe without the time the limit is about does not pass on a limited day', () => {
    const none = { ...base, id: 'none' }
    const onlyCook = { ...base, id: 'onlyCook', cookTime: 10 }
    expect(matchRecipes([none], { ...baseOptions, timeBudget: { mode: 'total', minutes: 30 } })).toHaveLength(0)
    expect(matchRecipes([none, onlyCook], { ...baseOptions, timeBudget: { mode: 'activo', minutes: 30 } })).toHaveLength(0)
  })

  it('without a limit every recipe passes, timed or not', () => {
    const recipes = [
      { ...base, id: 'none' },
      { ...base, id: 'slow', prepTime: 30, totalTime: 240 },
    ]
    expect(matchRecipes(recipes, baseOptions)).toHaveLength(2)
    expect(matchRecipes(recipes, { ...baseOptions, timeBudget: null })).toHaveLength(2)
    expect(matchRecipes(recipes, { ...baseOptions, timeBudget: { mode: 'total', minutes: 0 } })).toHaveLength(2)
  })

  it('legacy maxPrepMinutes is a total-time limit', () => {
    const quick = { ...base, id: 'quick', prepTime: 10 }
    const slow = { ...base, id: 'slow', prepTime: 10, totalTime: 90 }
    expect(ids(matchRecipes([quick, slow], { ...baseOptions, maxPrepMinutes: 30 }))).toEqual(['quick'])
    expect(matchRecipes([slow], { ...baseOptions, maxPrepMinutes: 0 })).toHaveLength(1)
    expect(matchRecipes([slow], { ...baseOptions, maxPrepMinutes: -5 })).toHaveLength(1)
  })
})

describe('matchRecipes: dislikes (user_memories)', () => {
  it('excludes recipes whose ingredients contain a disliked name', () => {
    const out = matchRecipes(RECIPES, {
      ...baseOptions,
      dislikes: ['calabacín'],
    })
    expect(out.map((r) => r.id)).not.toContain('r2')
    expect(out.map((r) => r.id).sort()).toEqual(['r1', 'r3'])
  })

  it('is case-insensitive', () => {
    const out = matchRecipes(RECIPES, {
      ...baseOptions,
      dislikes: ['CALABACÍN'],
    })
    expect(out.map((r) => r.id)).not.toContain('r2')
  })

  it('treats empty / absent dislikes as a no-op', () => {
    expect(matchRecipes(RECIPES, { ...baseOptions, dislikes: [] }).length).toBe(3)
    expect(matchRecipes(RECIPES, baseOptions).length).toBe(3)
  })

  it('merges with restrictions — a recipe gets dropped if it hits either set', () => {
    const out = matchRecipes(RECIPES, {
      ...baseOptions,
      restrictions: ['lentejas'],
      dislikes: ['masa'],
    })
    expect(out.map((r) => r.id)).toEqual(['r2'])
  })
})

describe('matchRecipes: bannedRecipeIds', () => {
  it('excludes recipes whose ids appear in bannedRecipeIds', () => {
    const out = matchRecipes(RECIPES, {
      ...baseOptions,
      bannedRecipeIds: new Set(['r2']),
    })
    const ids = out.map((r) => r.id)
    expect(ids).not.toContain('r2')
    // The other two stay in the pool (they pass every other predicate).
    expect(ids).toEqual(expect.arrayContaining(['r1', 'r3']))
  })

  it('treats an empty bannedRecipeIds set as a no-op', () => {
    const out = matchRecipes(RECIPES, {
      ...baseOptions,
      bannedRecipeIds: new Set(),
    })
    expect(out.map((r) => r.id).sort()).toEqual(['r1', 'r2', 'r3'])
  })

  it('treats an absent bannedRecipeIds field as a no-op (backwards compat)', () => {
    // Existing call sites in menuGenerator + menus.ts pass MatcherOptions
    // without this field. The new filter must be opt-in.
    const out = matchRecipes(RECIPES, baseOptions)
    expect(out.map((r) => r.id).sort()).toEqual(['r1', 'r2', 'r3'])
  })

  it('bans win over favorites — a banned favorite is still excluded', () => {
    const out = matchRecipes(RECIPES, {
      ...baseOptions,
      favoriteRecipeIds: new Set(['r2']),
      bannedRecipeIds: new Set(['r2']),
    })
    expect(out.map((r) => r.id)).not.toContain('r2')
  })
})

describe('matchRecipes: allergies and diets (2026-10-07 regression)', () => {
  // r1 has chorizo (meat) in its name only — its ingredient is lentejas — so
  // the diet check must come from ingredients. r4 carries a gluten tag on
  // the recipe; r5 only on the ingredient's catalogue entry.
  const POOL: RecipeWithIngredients[] = [
    ...RECIPES,
    {
      id: 'r4',
      name: 'Espaguetis al pesto',
      meals: ['lunch'],
      seasons: ['spring'],
      tags: [],
      allergens: ['gluten', 'frutos_secos'],
      ingredients: [{ ingredientId: 'i4', ingredientName: 'espaguetis', quantity: 200, unit: 'g' }],
    },
    {
      id: 'r5',
      name: 'Pollo al curry',
      meals: ['lunch'],
      seasons: ['spring'],
      tags: [],
      ingredients: [
        { ingredientId: 'i5', ingredientName: 'pechuga de pollo', quantity: 300, unit: 'g' },
        { ingredientId: 'i6', ingredientName: 'curry en polvo', quantity: 5, unit: 'g', allergenTags: ['mostaza'] },
      ],
    },
  ]
  const ids = (restrictions: string[]) =>
    matchRecipes(POOL, { ...baseOptions, restrictions }).map((r) => r.id).sort()

  it('"sin gluten" drops recipes with gluten (recipe union or ingredient name)', () => {
    // r3's untagged "masa" (dough) counts as gluten since PRO-61's prudent
    // rules: any dough/flour that doesn't name a gluten-free base.
    expect(ids(['sin gluten'])).toEqual(['r1', 'r2', 'r5'])
  })

  it('"frutos secos" and "mostaza" use the allergen tags', () => {
    expect(ids(['frutos secos'])).not.toContain('r4')
    expect(ids(['mostaza'])).not.toContain('r5')
  })

  it('"vegetariano" drops meat by ingredient', () => {
    expect(ids(['vegetariano'])).not.toContain('r5')
    expect(ids(['vegetariano'])).toContain('r2')
  })
})
