/**
 * PRO-238 — the generator doesn't put the same main protein at lunch and
 * dinner of one day (the classification of tasteDeck.ts), unless nothing
 * else fits. The new household got «lentejas estofadas» for lunch and
 * «lentejas guisadas» for dinner the same Sunday.
 */
import { describe, expect, it } from 'vitest'
import catalog from './fixtures/catalog-2026-10-12.json'
import { buildRandomMenu, defaultTemplate, mainProteinOf } from '../services/menuGenerator.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

const recipe = (id: string, name: string, ings: string[], meals = ['lunch', 'dinner']): RecipeWithCourse => ({
  id,
  name,
  meals,
  seasons: [],
  frequency: null,
  tags: [],
  allergens: [],
  course: null,
  ingredients: ings.map((n, j) => ({ ingredientId: `${id}-${j}`, ingredientName: n, quantity: 100, unit: 'g', allergenTags: [] })),
})

const oneDay = [{ lunch: true, dinner: true }] as any

describe('mainProteinOf', () => {
  it('carne, pescado, legumbre, huevo; vegetables are no protein', () => {
    expect(mainProteinOf(recipe('a', 'Lentejas estofadas', ['lentejas', 'zanahoria']))).toBe('legumbre')
    expect(mainProteinOf(recipe('b', 'Pollo al ajillo', ['pollo', 'ajo']))).toBe('carne')
    expect(mainProteinOf(recipe('c', 'Crema de calabaza', ['calabaza', 'cebolla']))).toBeNull()
  })
})

describe('buildRandomMenu: one protein per day (PRO-238)', () => {
  it('lentejas estofadas and lentejas guisadas never share a day when there is something else', () => {
    const pool = [
      recipe('l1', 'Lentejas estofadas', ['lentejas', 'zanahoria']),
      recipe('l2', 'Lentejas guisadas', ['lentejas', 'pimiento']),
      recipe('g1', 'Garbanzos con espinacas', ['garbanzos', 'espinacas']),
      recipe('t1', 'Tortilla de patatas', ['huevos', 'patata']),
    ]
    for (let i = 0; i < 60; i++) {
      const { days } = buildRandomMenu(oneDay, pool, 'autumn', [], new Set(), {})
      const ids = [days[0].lunch?.dishes?.[0], days[0].dinner?.dishes?.[0]].map((d: any) => d?.recipeId)
      expect(ids.filter((id) => id === 't1')).toHaveLength(1)
    }
  })

  it('same protein only when nothing else fits', () => {
    const pool = [
      recipe('l1', 'Lentejas estofadas', ['lentejas', 'zanahoria']),
      recipe('l2', 'Lentejas guisadas', ['lentejas', 'pimiento']),
    ]
    const { days } = buildRandomMenu(oneDay, pool, 'autumn', [], new Set(), {})
    expect(days[0].lunch?.dishes).toHaveLength(1)
    expect(days[0].dinner?.dishes).toHaveLength(1)
  })

  it('over the real catalogue, a generated week never repeats a protein in a day when the catalogue had another', () => {
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
    const byId = new Map(pool.map((r) => [r.id, r]))
    let sameDay = 0
    for (let i = 0; i < 10; i++) {
      const { days } = buildRandomMenu(defaultTemplate(), pool, 'autumn', [], new Set(), {})
      for (const d of days) {
        const l = d.lunch?.dishes?.[0] as any
        const c = d.dinner?.dishes?.[0] as any
        if (!l || !c) continue
        const pl = mainProteinOf(byId.get(l.recipeId)!)
        const pc = mainProteinOf(byId.get(c.recipeId)!)
        if (pl && pl === pc) sameDay++
      }
    }
    expect(sameDay).toBe(0)
  })
})
