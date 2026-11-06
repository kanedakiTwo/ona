/**
 * PRO-377 · «Rehacer la semana con mis favoritas»: with `onlyFavorites` the
 * week comes out of the household's favourites; what they don't fill comes
 * from the catalogue and `favoritesShort` says how many dishes are new.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMenuSchema, type DayMenu, type DayTemplate } from '@ona/shared'
import { buildRandomMenu, countOutsideFavorites, defaultTemplate } from '../services/menuGenerator.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

const VEG = ['calabacín', 'berenjena', 'pimiento', 'espinacas', 'acelgas', 'brócoli', 'coliflor', 'puerro', 'zanahoria', 'calabaza']
const pool: RecipeWithCourse[] = Array.from({ length: 40 }, (_, i) => ({
  id: `r${i}`,
  name: `Plato ${i}`,
  meals: ['lunch', 'dinner'],
  seasons: [],
  frequency: null,
  tags: [],
  allergens: [],
  course: null,
  ingredients: [VEG[i % VEG.length]].map((n, j) => ({ ingredientId: `i${i}-${j}`, ingredientName: n, quantity: 100, unit: 'g', allergenTags: [] })),
})) as unknown as RecipeWithCourse[]

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
afterEach(() => vi.restoreAllMocks())

const recipeIds = (days: DayMenu[]) => days.flatMap((d) => Object.values(d).flatMap((s) => (s?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeId] : []))))
const week = (template: DayTemplate[], favourites: Set<string>) =>
  buildRandomMenu(template, pool, 'autumn', [], new Set(), {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, favourites)

describe('the week with my favourites', () => {
  // Lunch and dinner Monday to Friday, lunch at the weekend: 12 dishes.
  const twelveSlots: DayTemplate[] = Array.from({ length: 7 }, (_, d) => (d < 5 ? { lunch: true, dinner: true } : { lunch: true }))

  it('12 favourites: every dish comes from them', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(5))
    const favourites = new Set(pool.slice(20, 32).map((r) => r.id))
    for (let i = 0; i < 20; i++) {
      const { days, favoritesShort } = week(twelveSlots, favourites)
      const ids = recipeIds(days)
      expect(ids).toHaveLength(12)
      expect(ids.every((id) => favourites.has(id))).toBe(true)
      expect(favoritesShort).toBe(0)
      expect(countOutsideFavorites(days, favourites)).toBe(0)
    }
  })

  it('3 favourites: the 3 come out, the rest is the catalogue, with favoritesShort right', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(9))
    const favourites = new Set(['r3', 'r17', 'r30'])
    for (let i = 0; i < 20; i++) {
      const { days, favoritesShort } = week(defaultTemplate(), favourites)
      const ids = recipeIds(days)
      expect(ids).toHaveLength(14)
      for (const id of favourites) expect(ids).toContain(id)
      expect(new Set(ids).size).toBe(14)
      expect(favoritesShort).toBe(11)
      expect(countOutsideFavorites(days, favourites)).toBe(11)
    }
  })

  it('without the flag nothing changes: no favourite is forced in', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(2))
    const { favoritesShort } = buildRandomMenu(defaultTemplate(), pool, 'autumn', [], new Set(), {})
    expect(favoritesShort).toBe(0)
  })

  it('locked slots and tápers do not count as new dishes', () => {
    const days: DayMenu[] = [
      { lunch: { dishes: [{ kind: 'recipe', recipeId: 'x1', recipeName: 'Fijado' }] }, dinner: { dishes: [{ kind: 'recipe', recipeId: 'r3', recipeName: 'Fav' }] } },
      { lunch: { dishes: [{ kind: 'recipe', recipeId: 'r3', recipeName: 'Fav', variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner' } } as any] }, dinner: { dishes: [{ kind: 'recipe', recipeId: 'x2', recipeName: 'Nuevo' }] } },
    ]
    expect(countOutsideFavorites(days, new Set(['r3']), { '0': { lunch: true } })).toBe(1)
  })

  it('the API takes `onlyFavorites`', () => {
    const body = { userId: '00000000-0000-4000-8000-000000000001', weekStart: '2026-11-02', onlyFavorites: true }
    expect(generateMenuSchema.parse(body).onlyFavorites).toBe(true)
  })
})
