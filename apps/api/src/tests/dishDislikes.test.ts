/**
 * PRO-1142 (E-68): «Oreja a la plancha» was saved as Miguel's dislike, but
 * dislikes were only compared with the ingredients («oreja de cerdo») and a
 * «Me apetece» of 19-oct boosted the recipe: «me lo pones cada 15 días y cada
 * 15 días te digo que no». Now a dislike also reads the recipe's name, and
 * between a dislike and a «Me apetece» on the same recipe the latest wins.
 *
 * Run: cd apps/api && npx vitest run src/tests/dishDislikes.test.ts
 */
import { describe, expect, it } from 'vitest'
import catalog from './fixtures/catalog-2026-10-12.json'
import { compileRestrictions, violatesRestrictions } from '../services/dietaryRestrictions.js'
import { dislikeDates, dislikeOverrides, recipeIdsNamedByDislikes } from '../services/dishDislikes.js'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import { matchRecipes } from '../services/recipeMatcher.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

const line = (id: string, j: number, ingredientName: string) => ({ ingredientId: `${id}-${j}`, ingredientName, quantity: 100, unit: 'g', allergenTags: [] })

const catalogPool: RecipeWithCourse[] = (catalog as any[]).map((r, i) => ({
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
  ingredients: r.ingredients.map((n: string, j: number) => line(`r${i}`, j, n)),
}))

const recipe = (id: string, name: string, ingredients: string[]): RecipeWithCourse => ({
  id, name, meals: ['lunch', 'dinner'], seasons: [], frequency: null, tags: [], allergens: [], course: null,
  ingredients: ingredients.map((n, j) => line(id, j, n)),
})

const OREJA = recipe('oreja', 'Oreja a la plancha', ['oreja de cerdo', 'ajo', 'perejil', 'aceite de oliva'])
const PIMIENTOS = recipe('pimientos', 'Pimientos rellenos de carne', ['pimiento rojo', 'carne picada de ternera', 'cebolla'])

const at = (day: string) => new Date(`${day}T12:00:00+02:00`)

/** Miguel's dislike, added on `day` (the ficha's history row). */
const dislikeAddedOn = (day: string, items = ['Oreja a la plancha']) =>
  dislikeDates({
    facts: [{ type: 'dislikes', value: items, createdAt: at('2026-10-01'), updatedAt: at(day) }],
    changes: [{ before: { value: items.slice(1) }, after: { value: items }, createdAt: at(day) }],
  })

/** The pool `loadMatchableRecipes` would give: the catalogue plus the recipe, annotated. */
const annotated = (dislikedAt: Map<string, number>, positiveAt: Map<string, number>, extra: RecipeWithCourse[] = [OREJA]) => {
  const pool = [...catalogPool, ...extra]
  const overrides = dislikeOverrides(pool, dislikedAt, positiveAt)
  return pool.map((r) => ({ ...r, dislikesOverridden: overrides.get(r.id) ?? [] }))
}

const recipeIds = (days: ReturnType<typeof buildRandomMenu>['days']) =>
  days.flatMap((d) => Object.values(d).flatMap((slot) => (slot?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeId] : []))))

/** Ten generated weeks, «Me apetece» weighing in (`likedRecipeIds`) as in the generator. */
const tenWeeks = (pool: RecipeWithCourse[], dislikes: string[], liked: Set<string>) =>
  Array.from({ length: 10 }, () =>
    recipeIds(buildRandomMenu(defaultTemplate(), pool, 'autumn', [], new Set(), {}, undefined, undefined, undefined, dislikes, undefined, undefined, undefined, undefined, liked).days),
  ).flat()

const lunchPool = (pool: RecipeWithCourse[], dislikes: string[]) =>
  matchRecipes(pool, { meal: 'lunch', season: 'autumn', usedRecipeIds: new Set(), restrictions: [], favoriteRecipeIds: new Set(), dislikes }).map((r) => r.id)

describe('a dislike that names the dish', () => {
  it('«Oreja a la plancha» keeps out the recipe whose ingredient is «oreja de cerdo»', () => {
    const rules = compileRestrictions([], ['Oreja a la plancha'])
    expect(violatesRestrictions(OREJA, rules)).toBe(true)
    // Before: only the ingredients were read, and they don't say it.
    expect(violatesRestrictions({ ingredients: OREJA.ingredients }, rules)).toBe(false)
    // Whole words, plural-tolerant: «oreja» hides «Orejas guisadas», not «Orejones con yogur».
    expect(violatesRestrictions({ name: 'Orejas guisadas', ingredients: [] }, compileRestrictions([], ['oreja']))).toBe(true)
    expect(violatesRestrictions({ name: 'Orejones con yogur', ingredients: [] }, compileRestrictions([], ['oreja']))).toBe(false)
  })

  it('never comes out in 10 generated weeks', () => {
    const pool = annotated(new Map(), new Map())
    expect(lunchPool(pool, [])).toContain('oreja')
    expect(tenWeeks(pool, ['Oreja a la plancha'], new Set())).not.toContain('oreja')
  })

  it('restrictions (allergies, diets) are not read against the name: only dislikes', () => {
    expect(compileRestrictions(['cilantro'], []).dishTerms).toEqual([])
    expect(compileRestrictions([], ['  Oreja a la plancha ']).dishTerms).toEqual(['oreja a la plancha'])
  })
})

describe('a dislike and a «Me apetece» on the same recipe: the latest wins', () => {
  const liked = new Set(['oreja'])
  const likedOn19Oct = new Map([['oreja', at('2026-10-19').getTime()]])

  it('«Me apetece» on 19-oct, the dislike after it: never comes out, the boost doesn\'t help', () => {
    const pool = annotated(dislikeAddedOn('2026-10-25'), likedOn19Oct)
    expect(pool.find((r) => r.id === 'oreja')!.dislikesOverridden).toEqual([])
    expect(lunchPool(pool, ['Oreja a la plancha'])).not.toContain('oreja')
    expect(tenWeeks(pool, ['Oreja a la plancha'], liked)).not.toContain('oreja')
  })

  it('the dislike first, «Me apetece» on 19-oct after it: it can come out again', () => {
    const pool = annotated(dislikeAddedOn('2026-10-05'), likedOn19Oct)
    expect(pool.find((r) => r.id === 'oreja')!.dislikesOverridden).toEqual(['oreja a la plancha'])
    expect(lunchPool(pool, ['Oreja a la plancha'])).toContain('oreja')
    // With «mis favoritas» on just this recipe, the week does take it.
    const days = buildRandomMenu(defaultTemplate(), pool, 'autumn', [], new Set(), {}, undefined, undefined, undefined, ['Oreja a la plancha'], undefined, undefined, undefined, undefined, liked, undefined, undefined, new Set(['oreja'])).days
    expect(recipeIds(days)).toContain('oreja')
  })

  it('a 5-star «¿repetimos?» counts like a «Me apetece»; a dislike with no date is never beaten', () => {
    const pool = [OREJA]
    expect(dislikeOverrides(pool, dislikeAddedOn('2026-10-05'), new Map([['oreja', at('2026-10-20').getTime()]])).get('oreja')).toEqual(['oreja a la plancha'])
    expect(dislikeOverrides(pool, new Map(), likedOn19Oct).size).toBe(0)
  })

  it('the ficha\'s history dates each item: a later item added to the list doesn\'t move the earlier one', () => {
    const dates = dislikeDates({
      facts: [{ type: 'dislikes', value: ['Oreja a la plancha', 'cilantro'], createdAt: at('2026-10-01'), updatedAt: at('2026-10-30') }],
      changes: [
        { before: null, after: { value: ['Oreja a la plancha'] }, createdAt: at('2026-10-01') },
        { before: { value: ['Oreja a la plancha'] }, after: { value: ['Oreja a la plancha', 'cilantro'] }, createdAt: at('2026-10-30') },
      ],
    })
    expect(dates.get('oreja a la plancha')).toBe(at('2026-10-01').getTime())
    expect(dates.get('cilantro')).toBe(at('2026-10-30').getTime())
    // Removed and said again: the last time counts.
    const again = dislikeDates({
      changes: [
        { before: null, after: { value: ['oreja a la plancha'] }, createdAt: at('2026-10-01') },
        { before: { value: ['oreja a la plancha'] }, after: { value: [] }, createdAt: at('2026-10-10') },
        { before: { value: [] }, after: { value: ['Oreja a la plancha'] }, createdAt: at('2026-10-28') },
      ],
    })
    expect(again.get('oreja a la plancha')).toBe(at('2026-10-28').getTime())
  })
})

describe('a dislike of an ingredient still works by ingredient', () => {
  it('«pimiento» keeps out what has pimiento, even with a later «Me apetece» on a dish it names', () => {
    const conPimiento = recipe('pisto', 'Verduras de la huerta', ['pimiento verde', 'calabacín', 'tomate'])
    const pool = annotated(dislikeAddedOn('2026-10-05', ['pimiento']), new Map([['pimientos', at('2026-10-19').getTime()]]), [PIMIENTOS, conPimiento])
    expect(pool.find((r) => r.id === 'pimientos')!.dislikesOverridden).toEqual(['pimiento'])
    const ids = lunchPool(pool, ['pimiento'])
    expect(ids).not.toContain('pisto')
    expect(ids).not.toContain('pimientos')
    expect(ids.length).toBeGreaterThan(0)
  })
})

describe('«Elegir otra receta» (?fitsMe=1)', () => {
  it('hides the dishes a dislike names, unless a later «Me apetece» beats it; ingredient dislikes stay pickable', () => {
    expect(recipeIdsNamedByDislikes([OREJA, PIMIENTOS], ['Oreja a la plancha'])).toEqual(['oreja'])
    expect(recipeIdsNamedByDislikes([{ ...OREJA, dislikesOverridden: ['oreja a la plancha'] }], ['Oreja a la plancha'])).toEqual([])
    expect(recipeIdsNamedByDislikes([recipe('x', 'Verduras', ['pimiento verde'])], ['pimiento'])).toEqual([])
    expect(recipeIdsNamedByDislikes([OREJA], [])).toEqual([])
  })
})
