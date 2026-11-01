/**
 * Catalogue season rule + client-side filters (`/recipes`, "D · Luz y foto").
 *
 * Why this exists: until 2026-10-08 every catalogue card showed
 * `seasonLabel(recipe.seasons[0])` — the FIRST season in the recipe's list.
 * Nearly every recipe is all-year with `spring` first, so in October the
 * whole grid said "PRIMAVERA". Cards show no season now; the rule for
 * "De temporada" lives in `@ona/shared` (`utils/catalog.ts`) and is pinned here:
 *   - "now" is `detectSeason(date)` (meteorological, Spain: Sep–Nov = otoño),
 *     the same rule the menu generator uses;
 *   - "De temporada" = recipes that fit the current season (all-year ones
 *     included), the featured card is always in season and has a photo.
 *
 * Run: pnpm --filter @ona/api test src/tests/catalogSeason.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  detectSeason,
  isAllYearRecipe,
  isCuratedRecipe,
  recipeMinutes,
  filterCatalogRecipes,
  pickFeaturedRecipes,
  isQuickDinner,
  isNibbles,
  isGlutenFree,
  matchesCatalogIntent,
  type Season,
} from '@ona/shared'

const OCTOBER = new Date(2026, 9, 8, 12) // 8 Oct 2026, local time
const ALL_YEAR: Season[] = ['spring', 'summer', 'autumn', 'winter']

function recipe(
  id: string,
  over: Partial<{
    authorId: string | null
    imageUrl: string | null
    seasons: Season[]
    prepTime: number | null
    totalTime: number | null
  }> = {},
) {
  return {
    id,
    name: id,
    authorId: null,
    imageUrl: `/images/recipes/${id}.jpg`,
    seasons: ALL_YEAR,
    prepTime: 10,
    totalTime: 20,
    ...over,
  }
}

describe('current season (Spain, meteorological — shared with the menu generator)', () => {
  it('October is autumn, never spring', () => {
    expect(detectSeason(OCTOBER)).toBe('autumn')
  })

  it('month boundaries: Sep 1 autumn, Nov 30 autumn, Dec 1 winter, Mar 1 spring, Jun 1 summer', () => {
    expect(detectSeason(new Date(2026, 8, 1))).toBe('autumn')
    expect(detectSeason(new Date(2026, 10, 30))).toBe('autumn')
    expect(detectSeason(new Date(2026, 11, 1))).toBe('winter')
    expect(detectSeason(new Date(2027, 1, 28))).toBe('winter')
    expect(detectSeason(new Date(2027, 2, 1))).toBe('spring')
    expect(detectSeason(new Date(2027, 5, 1))).toBe('summer')
  })
})

describe('isAllYearRecipe', () => {
  it('isAllYearRecipe: empty or all four seasons', () => {
    expect(isAllYearRecipe([])).toBe(true)
    expect(isAllYearRecipe(['winter', 'autumn', 'summer', 'spring'])).toBe(true)
    expect(isAllYearRecipe(['autumn', 'winter'])).toBe(false)
  })
})

describe('recipeMinutes — the time shown on cards and used by "En 30 min"', () => {
  it('prefers the total time over the prep time', () => {
    expect(recipeMinutes({ prepTime: 15, totalTime: 45 })).toBe(45)
  })
  it('falls back to prep time, and never returns 0', () => {
    expect(recipeMinutes({ prepTime: 15, totalTime: null })).toBe(15)
    expect(recipeMinutes({ prepTime: 0, totalTime: 0 })).toBeNull()
    expect(recipeMinutes({})).toBeNull()
  })
})

describe('filterCatalogRecipes — chips + advanced filters', () => {
  const me = 'user-1'
  const list = [
    recipe('lentejas', { seasons: ['autumn', 'winter'], totalTime: 55, prepTime: 10 }),
    recipe('gazpacho', { seasons: ['spring', 'summer'], totalTime: 15 }),
    recipe('tortilla', { seasons: ALL_YEAR, totalTime: 25 }),
    recipe('sin-tiempo', { seasons: ALL_YEAR, totalTime: null, prepTime: null }),
    recipe('mia', { authorId: me, seasons: ALL_YEAR, totalTime: 30 }),
  ]
  const names = (rs: { id: string }[]) => rs.map((r) => r.id)

  it('no filters → everything', () => {
    expect(names(filterCatalogRecipes(list, { scope: 'all', userId: me }))).toHaveLength(5)
  })

  it('"De temporada" in October keeps autumn + all-year recipes and drops spring/summer-only ones', () => {
    const out = names(
      filterCatalogRecipes(list, { scope: 'all', userId: me, season: detectSeason(OCTOBER) }),
    )
    expect(out).toContain('lentejas')
    expect(out).toContain('tortilla')
    expect(out).not.toContain('gazpacho')
  })

  it('"En 30 min" uses the total time and drops recipes with unknown time', () => {
    const out = names(filterCatalogRecipes(list, { scope: 'all', userId: me, maxTime: 30 }))
    expect(out).toEqual(['gazpacho', 'tortilla', 'mia'])
    // lentejas: 10 min prep but 55 min total → not "en 30 min"
    expect(out).not.toContain('lentejas')
  })

  it('"Selección Mimoia" = system recipes only; "Mis recetas" = the caller\'s only', () => {
    expect(names(filterCatalogRecipes(list, { scope: 'ona', userId: me }))).not.toContain('mia')
    expect(names(filterCatalogRecipes(list, { scope: 'mine', userId: me }))).toEqual(['mia'])
    expect(isCuratedRecipe(list[0])).toBe(true)
    expect(isCuratedRecipe(list[4])).toBe(false)
  })
})

describe('intent chips (PRO-376) — one recipe in, one out', () => {
  const names = (rs: { id: string }[]) => rs.map((r) => r.id)
  const filter = (list: ReturnType<typeof recipe>[], over: Parameters<typeof filterCatalogRecipes>[1]) =>
    names(filterCatalogRecipes(list, over))

  it('«Listas en 15 min» is the 15-minute time filter', () => {
    const list = [recipe('tostada', { totalTime: 10 }), recipe('tortilla', { totalTime: 25 })]
    expect(filter(list, { scope: 'all', maxTime: 15 })).toEqual(['tostada'])
  })

  it('«Cenas rápidas»: dinner and at most 30 min', () => {
    const tortilla = { ...recipe('tortilla', { totalTime: 25 }), meals: ['dinner'] }
    const guiso = { ...recipe('guiso', { totalTime: 70 }), meals: ['dinner'] }
    const lunch = { ...recipe('ensalada', { totalTime: 15 }), meals: ['lunch'] }
    expect(isQuickDinner(tortilla)).toBe(true)
    expect(isQuickDinner(guiso)).toBe(false)
    expect(isQuickDinner(lunch)).toBe(false)
    expect(names(filterCatalogRecipes([tortilla, guiso, lunch], { scope: 'all', intents: ['quickDinner'] }))).toEqual([
      'tortilla',
    ])
  })

  it('«Para picar»: a starter or tagged picoteo', () => {
    const croquetas = { ...recipe('croquetas'), course: 'starter', tags: [] }
    const hummus = { ...recipe('hummus'), course: null, tags: ['Picoteo'] }
    const lentejas = { ...recipe('lentejas'), course: 'main', tags: ['legumbres'] }
    expect(isNibbles(croquetas)).toBe(true)
    expect(isNibbles(hummus)).toBe(true)
    expect(isNibbles(lentejas)).toBe(false)
    expect(matchesCatalogIntent(lentejas, 'nibbles')).toBe(false)
  })

  it('«Sin gluten»: no gluten allergen and no allergen doubt', () => {
    const arroz = { ...recipe('arroz'), allergens: ['pescado'], allergenDoubt: false }
    const pizza = { ...recipe('pizza'), allergens: ['gluten', 'lactosa'], allergenDoubt: false }
    const dudosa = { ...recipe('dudosa'), allergens: [], allergenDoubt: true }
    expect(isGlutenFree(arroz)).toBe(true)
    expect(isGlutenFree(pizza)).toBe(false)
    expect(isGlutenFree(dudosa)).toBe(false)
    expect(names(filterCatalogRecipes([arroz, pizza, dudosa], { scope: 'all', intents: ['glutenFree'] }))).toEqual([
      'arroz',
    ])
  })

  it('several intents on: a recipe must match all of them', () => {
    const tortilla = { ...recipe('tortilla', { totalTime: 20 }), meals: ['dinner'], allergens: [] }
    const croque = { ...recipe('croque', { totalTime: 20 }), meals: ['dinner'], allergens: ['gluten'] }
    expect(
      names(filterCatalogRecipes([tortilla, croque], { scope: 'all', intents: ['quickDinner', 'glutenFree'] })),
    ).toEqual(['tortilla'])
  })
})

describe('pickFeaturedRecipes — the "De temporada" hero', () => {
  const list = [
    recipe('gazpacho', { seasons: ['spring', 'summer'] }),
    recipe('tortilla', { seasons: ALL_YEAR }),
    recipe('crema-calabaza', { seasons: ['autumn', 'winter'] }),
    recipe('carrilleras', { seasons: ['autumn', 'winter'] }),
    recipe('setas-sin-foto', { seasons: ['autumn'], imageUrl: null }),
    recipe('mi-guiso', { seasons: ['autumn'], authorId: 'user-1' }),
  ]

  it('in October only picks in-season curated recipes with a photo, preferring seasonal ones', () => {
    const picked = pickFeaturedRecipes(list, { date: OCTOBER, count: 2 }).map((r) => r.id)
    expect(picked).toHaveLength(2)
    expect(new Set(picked)).toEqual(new Set(['crema-calabaza', 'carrilleras']))
  })

  it('never features an out-of-season or photo-less recipe', () => {
    for (let day = 0; day < 30; day++) {
      const picked = pickFeaturedRecipes(list, { date: new Date(2026, 9, 1 + day), count: 2 })
      for (const r of picked) {
        expect(r.id).not.toBe('gazpacho')
        expect(r.id).not.toBe('setas-sin-foto')
      }
    }
  })

  it('is stable for a given day', () => {
    const a = pickFeaturedRecipes(list, { date: OCTOBER, count: 1 })
    const b = pickFeaturedRecipes(list, { date: new Date(2026, 9, 8, 23), count: 1 })
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
  })

  it('falls back to all-year curated recipes when nothing seasonal has a photo', () => {
    const picked = pickFeaturedRecipes([list[0], list[1]], { date: OCTOBER, count: 2 })
    expect(picked.map((r) => r.id)).toEqual(['tortilla'])
  })

  it('returns nothing for an empty catalogue', () => {
    expect(pickFeaturedRecipes([], { date: OCTOBER, count: 2 })).toEqual([])
  })
})
