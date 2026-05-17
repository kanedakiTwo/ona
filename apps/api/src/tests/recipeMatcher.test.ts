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

describe('matchRecipes: maxPrepMinutes (user_memories.time_available[weekday])', () => {
  const quick = {
    id: 'q1',
    name: 'Tostada',
    meals: ['breakfast', 'lunch'],
    seasons: ['spring'],
    tags: [],
    prepTime: 10,
    ingredients: [],
  }
  const slow = { ...quick, id: 'q2', name: 'Cocido', prepTime: 90 }
  const unknown = { ...quick, id: 'q3', name: 'Pan crudo', prepTime: undefined }

  it('excludes recipes whose prepTime exceeds the day\'s budget', () => {
    const out = matchRecipes([quick, slow, unknown], {
      ...baseOptions,
      maxPrepMinutes: 30,
    })
    // Quick passes (10 ≤ 30); slow fails (90 > 30); unknown passes (no data,
    // err on inclusion — better one extra question to the user than empty pool)
    expect(out.map((r) => r.id).sort()).toEqual(['q1', 'q3'])
  })

  it('treats absent maxPrepMinutes as no-op', () => {
    const out = matchRecipes([quick, slow, unknown], baseOptions)
    expect(out.length).toBe(3)
  })

  it('zero or negative cap is treated as "no cap" (defensive)', () => {
    expect(
      matchRecipes([slow], { ...baseOptions, maxPrepMinutes: 0 }).length,
    ).toBe(1)
    expect(
      matchRecipes([slow], { ...baseOptions, maxPrepMinutes: -5 }).length,
    ).toBe(1)
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
