/**
 * PRO-1200 · El primer menú, solo con recetas «de diario»: with an invented
 * catalogue, a starting household only gets `diario` recipes, a slot none
 * fits takes another, a household past starting gets at most 2 from outside,
 * and with no `diario` in the catalogue the menu comes out as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EVERYDAY_RECIPE_TAG, isEverydayRecipe, type DayMenu, type DayTemplate } from '@ona/shared'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import { findRecipeForSlot } from '../services/recipeMatcher.js'
import { DISCOVERIES_PER_WEEK, everydayPolicy, everydayTries, isStarting, slotEveryday, START_SIGNALS, START_WEEKS } from '../services/everydayMenu.js'

const VEG = ['calabacín', 'berenjena', 'pimiento', 'espinacas', 'acelgas', 'brócoli', 'coliflor', 'puerro', 'zanahoria', 'calabaza']
const recipe = (id: string, everyday: boolean, meals = ['lunch', 'dinner'], i = 0) =>
  ({
    id,
    name: `Plato ${id}`,
    meals,
    seasons: [],
    frequency: null,
    tags: [],
    internalTags: everyday ? [EVERYDAY_RECIPE_TAG] : [],
    allergens: [],
    course: null,
    ingredients: [{ ingredientId: `i-${id}`, ingredientName: VEG[i % VEG.length], quantity: 100, unit: 'g', allergenTags: [] }],
  }) as unknown as RecipeWithCourse

// 20 «de diario» (d0…d19) and 20 from blogs and creators (x0…x19).
const catalogue: RecipeWithCourse[] = [
  ...Array.from({ length: 20 }, (_, i) => recipe(`d${i}`, true, undefined, i)),
  ...Array.from({ length: 20 }, (_, i) => recipe(`x${i}`, false, undefined, i)),
]
const everydayIds = new Set(catalogue.filter((r) => isEverydayRecipe(r)).map((r) => r.id))

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
afterEach(() => vi.restoreAllMocks())

const recipeIds = (days: DayMenu[]) => days.flatMap((d) => Object.values(d).flatMap((s) => (s?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeId] : []))))
const week = (template: DayTemplate[], pool: RecipeWithCourse[], policy: ReturnType<typeof everydayPolicy>, favourites = new Set<string>()) =>
  buildRandomMenu(template, pool, 'autumn', [], favourites, {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, policy)

describe('starting', () => {
  it('fewer than 2 other weeks with a menu, or fewer than 5 signals', () => {
    expect(START_WEEKS).toBe(2)
    expect(START_SIGNALS).toBe(5)
    expect(isStarting(0, 0)).toBe(true)
    expect(isStarting(1, 20)).toBe(true)
    expect(isStarting(2, 4)).toBe(true)
    expect(isStarting(2, 5)).toBe(false)
    expect(isStarting(7, 30)).toBe(false)
  })

  it('no `diario` recipe in the catalogue: no policy', () => {
    expect(everydayPolicy(catalogue.filter((r) => !everydayIds.has(r.id)), true)).toBeNull()
    expect(everydayPolicy(catalogue, true)?.discoveries).toBe(0)
    expect(everydayPolicy(catalogue, false)?.discoveries).toBe(DISCOVERIES_PER_WEEK)
  })
})

describe('the weekly generator', () => {
  it('a new household only gets `diario` recipes', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(3))
    const policy = everydayPolicy(catalogue, true)
    for (let i = 0; i < 30; i++) {
      const ids = recipeIds(week(defaultTemplate(), catalogue, policy).days)
      expect(ids).toHaveLength(14)
      expect(ids.every((id) => everydayIds.has(id))).toBe(true)
    }
  })

  it('a slot no `diario` recipe fits is filled with another', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(4))
    const pool = [...catalogue, recipe('b0', false, ['breakfast'])]
    const template: DayTemplate[] = [{ breakfast: true, lunch: true, dinner: true }]
    const { days } = week(template, pool, everydayPolicy(pool, true))
    expect(days[0].breakfast?.dishes?.[0]).toMatchObject({ recipeId: 'b0' })
    expect([days[0].lunch, days[0].dinner].every((s) => everydayIds.has((s?.dishes?.[0] as any).recipeId))).toBe(true)
  })

  it('more slots than `diario` recipes: the week is still full', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(6))
    const pool = [...catalogue.slice(0, 10), ...catalogue.slice(20)]
    const ids = recipeIds(week(defaultTemplate(), pool, everydayPolicy(pool, true)).days)
    expect(ids).toHaveLength(14)
    expect(ids.filter((id) => everydayIds.has(id))).toHaveLength(10)
  })

  it('a household past starting gets at most 2 from outside, and some weeks does get them', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(8))
    const policy = everydayPolicy(catalogue, false)
    let withDiscoveries = 0
    for (let i = 0; i < 40; i++) {
      const outside = recipeIds(week(defaultTemplate(), catalogue, policy).days).filter((id) => !everydayIds.has(id))
      expect(outside.length).toBeLessThanOrEqual(2)
      if (outside.length > 0) withDiscoveries++
    }
    expect(withDiscoveries).toBeGreaterThan(0)
  })

  it('favourites do not count for the 2 from outside', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(10))
    const favourites = new Set(['x0', 'x1', 'x2', 'x3', 'x4', 'x5'])
    const policy = everydayPolicy(catalogue, false, favourites)
    let favouritesIn = 0
    for (let i = 0; i < 40; i++) {
      const ids = recipeIds(week(defaultTemplate(), catalogue, policy, favourites).days)
      expect(ids.filter((id) => !everydayIds.has(id) && !favourites.has(id)).length).toBeLessThanOrEqual(2)
      favouritesIn = Math.max(favouritesIn, ids.filter((id) => favourites.has(id)).length)
    }
    expect(favouritesIn).toBeGreaterThan(2)
  })

  it('with no `diario` recipe in the catalogue the menu comes out as today', () => {
    const pool = catalogue.filter((r) => !everydayIds.has(r.id))
    vi.spyOn(Math, 'random').mockImplementation(seeded(12))
    const before = buildRandomMenu(defaultTemplate(), pool, 'autumn', [], new Set(), {})
    vi.restoreAllMocks()
    vi.spyOn(Math, 'random').mockImplementation(seeded(12))
    const now = week(defaultTemplate(), pool, everydayPolicy(pool, true))
    expect(now.days).toEqual(before.days)
  })
})

describe('one slot change (menuSlotPick)', () => {
  const options = (everyday?: ReadonlySet<string>) => ({ meal: 'lunch' as const, season: 'autumn' as const, usedRecipeIds: new Set<string>(), restrictions: [], favoriteRecipeIds: new Set<string>(), everyday })

  it('starting: keeps to `diario`; past starting, only once the week has its 2 from outside', () => {
    const starting = everydayPolicy(catalogue, true)
    const after = everydayPolicy(catalogue, false)
    expect(slotEveryday(starting, ['d1', 'd2'])).toBe(starting!.ids)
    expect(slotEveryday(after, ['d1', 'x1'])).toBeUndefined()
    expect(slotEveryday(after, ['x1', 'x2', 'd1'])).toBe(after!.ids)
    expect(slotEveryday(null, ['x1', 'x2', 'x3'])).toBeUndefined()
  })

  it('the matcher keeps to the set when one fits, and draws from all when none does', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(14))
    const ids = everydayPolicy(catalogue, true)!.ids
    for (let i = 0; i < 30; i++) expect(ids.has(findRecipeForSlot(catalogue, options(ids))!.id)).toBe(true)
    const outside = catalogue.filter((r) => !ids.has(r.id))
    expect(findRecipeForSlot(outside, options(ids))).toBeDefined()
  })

  it('tries: `diario` first, then the pools as they were', () => {
    const policy = everydayPolicy(catalogue, true)
    const tries = everydayTries([catalogue], policy, 0)
    expect(tries).toHaveLength(2)
    expect(tries[0].every((r) => everydayIds.has(r.id))).toBe(true)
    expect(tries[1]).toBe(catalogue)
    expect(everydayTries([catalogue], policy, 1)).toEqual([catalogue])
  })
})
