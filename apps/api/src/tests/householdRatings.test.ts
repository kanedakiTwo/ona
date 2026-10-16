/**
 * PRO-111: the household's «¿Qué tal?» answers in the automatic menu
 * (specs/menus.md): 5 stars weigh like a favourite, 1 star never comes out on
 * its own, 3 changes nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import catalog from './fixtures/catalog-2026-10-12.json'
import { householdRatingSets, withHouseholdRatings } from '../services/householdRatings.js'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

const pool: RecipeWithCourse[] = (catalog as any[]).map((r, i) => ({
  id: `r${i}`,
  name: r.name,
  meals: r.meals,
  seasons: r.seasons,
  mealFit: r.mealFit ?? undefined,
  seasonFit: r.seasonFit ?? undefined,
  frequency: null,
  tags: [],
  allergens: r.allergens,
  course: null,
  ingredients: r.ingredients.map((n: string, j: number) => ({ ingredientId: `i${i}-${j}`, ingredientName: n, quantity: 100, unit: 'g', allergenTags: [] })),
}))

const picked = (favorites: Set<string>, banned: Set<string>) =>
  buildRandomMenu(defaultTemplate(), pool, 'autumn', [], favorites, {}, undefined, banned).days.flatMap((d) =>
    Object.values(d).flatMap((slot) => (slot?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeId] : []))),
  )

describe('householdRatingSets', () => {
  it('5 → boost, 1 → exclude, the rest nothing', () => {
    const { boost, exclude } = householdRatingSets([
      { recipeId: 'a', rating: 5 },
      { recipeId: 'b', rating: 3 },
      { recipeId: 'c', rating: 1 },
      { recipeId: 'd', rating: null },
    ])
    expect([...boost]).toEqual(['a'])
    expect([...exclude]).toEqual(['c'])
  })

  it('withHouseholdRatings adds to new sets and leaves the week’s vetoes alone', () => {
    const favorites = new Set(['f'])
    const banned = new Set(['v'])
    const out = withHouseholdRatings(favorites, banned, { boost: new Set(['a']), exclude: new Set(['c']) })
    expect([...out.favoriteRecipeIds].sort()).toEqual(['a', 'f'])
    expect([...out.bannedRecipeIds].sort()).toEqual(['c', 'v'])
    expect([...banned]).toEqual(['v'])
  })
})

describe('the generator with the three ratings', () => {
  // The first lunch-and-dinner recipe in season is the one we rate.
  const target = pool.find((r) => r.meals.includes('lunch') && r.meals.includes('dinner'))!.id
  const runs = 300
  // Seeded draws so the comparison is the same on every run (no flakes).
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  afterEach(() => vi.restoreAllMocks())
  const share = (favorites: Set<string>, banned: Set<string>) => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(42))
    const n = Array.from({ length: runs }, () => picked(favorites, banned)).filter((ids) => ids.includes(target)).length
    vi.restoreAllMocks()
    return n / runs
  }

  it('1 star: never in the automatic menu', () => {
    const { favoriteRecipeIds, bannedRecipeIds } = withHouseholdRatings(new Set(), new Set(), householdRatingSets([{ recipeId: target, rating: 1 }]))
    expect(share(favoriteRecipeIds, bannedRecipeIds)).toBe(0)
  })

  it('5 stars: comes out like a favourite, more often than unrated (3 stars)', () => {
    const five = withHouseholdRatings(new Set(), new Set(), householdRatingSets([{ recipeId: target, rating: 5 }]))
    const three = withHouseholdRatings(new Set(), new Set(), householdRatingSets([{ recipeId: target, rating: 3 }]))
    expect(five.favoriteRecipeIds.has(target)).toBe(true)
    expect(three.favoriteRecipeIds.has(target)).toBe(false)
    const s5 = share(five.favoriteRecipeIds, five.bannedRecipeIds)
    const s3 = share(three.favoriteRecipeIds, three.bannedRecipeIds)
    expect(s5).toBeGreaterThan(s3)
  })
})
