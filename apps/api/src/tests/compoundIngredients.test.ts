/**
 * PRO-198 — pork hidden in a compound ingredient.
 *
 * Hogares de prueba (el recién llegado, 2026-10-17): with «sin cerdo» saved,
 * the first menu had «Ropa vieja del cocido», whose ingredient «Sobras del
 * cocido madrileño» names no pork. A compound ingredient now carries what it
 * contains (`ingredients.contains_tags`) and the diet filter reads it.
 */
import { describe, expect, it } from 'vitest'
import catalog from './fixtures/catalog-2026-10-12.json'
import { compileRestrictions, recipeIdsBreakingRestrictions, violatesRestrictions } from '../services/dietaryRestrictions.js'
import {
  CONTAINS_TAGS,
  applyCompoundIngredientTags,
  compoundIngredientsWithoutTags,
  isCompoundIngredientName,
  knownCompoundTags,
} from '../services/compoundIngredients.js'

const ropaVieja = (containsTags: string[] = []) => ({
  name: 'Ropa vieja del cocido',
  allergens: [],
  ingredients: [
    { ingredientName: 'aceite de oliva virgen extra' },
    { ingredientName: 'sobras del cocido madrileño', containsTags },
    { ingredientName: 'cebolla' },
  ],
})

describe('diet filter reads what a compound ingredient contains', () => {
  it('«sin cerdo» can\'t see pork in «sobras del cocido madrileño» by its name alone', () => {
    expect(violatesRestrictions(ropaVieja(), compileRestrictions(['Sin cerdo']))).toBe(false)
  })

  it('«sin cerdo» excludes «Ropa vieja del cocido» once the leftovers say they carry pork', () => {
    const tags = [...(knownCompoundTags('Sobras del cocido madrileño') ?? [])]
    expect(tags).toContain('cerdo')
    expect(violatesRestrictions(ropaVieja(tags), compileRestrictions(['Sin cerdo']))).toBe(true)
    expect(violatesRestrictions(ropaVieja(tags), compileRestrictions(['halal']))).toBe(true)
  })

  it('a contained allergen tag counts for the allergy («sin gluten»)', () => {
    const r = { allergens: [], ingredients: [{ ingredientName: 'relleno casero', containsTags: ['gluten'] }] }
    expect(violatesRestrictions(r, compileRestrictions(['Sin gluten']))).toBe(true)
    expect(violatesRestrictions(r, compileRestrictions(['Sin lactosa']))).toBe(false)
  })

  it('a contained meat counts for vegetarians, and «vegetal» never excludes anything', () => {
    const chicken = { allergens: [], ingredients: [{ ingredientName: 'fondo oscuro', containsTags: ['pollo'] }] }
    expect(violatesRestrictions(chicken, compileRestrictions(['vegetariano']))).toBe(true)
    expect(violatesRestrictions(chicken, compileRestrictions(['Sin cerdo']))).toBe(false)
    const veg = { allergens: [], ingredients: [{ ingredientName: 'caldo de verduras', containsTags: ['vegetal'] }] }
    for (const r of ['vegano', 'vegetariano', 'Sin cerdo', 'Sin gluten', 'Sin alcohol']) {
      expect(violatesRestrictions(veg, compileRestrictions([r]))).toBe(false)
    }
  })

  it('a contained «alcohol» counts for «sin alcohol»', () => {
    const r = { allergens: [], ingredients: [{ ingredientName: 'salsa de la casa', containsTags: ['alcohol'] }] }
    expect(violatesRestrictions(r, compileRestrictions(['Sin alcohol']))).toBe(true)
  })

  it('over the catalogue, «sin cerdo» hides «Ropa vieja del cocido» and «Arroz al horno» with the known labels', () => {
    const fixture = catalog as Array<{ name: string; allergens: string[]; ingredients: string[] }>
    const pool = fixture.map((r, i) => ({
      id: r.name,
      name: r.name,
      allergens: r.allergens,
      ingredients: r.ingredients.map((n) => ({ ingredientName: n, containsTags: [...(knownCompoundTags(n) ?? [])] })),
    }))
    expect(fixture.some((r) => r.name === 'Ropa vieja del cocido')).toBe(true)
    const out = recipeIdsBreakingRestrictions(pool, ['Sin cerdo'])
    expect(out).toContain('Ropa vieja del cocido')
    expect(out).toContain('Arroz al horno')
    // Vegetable stock is labelled «vegetal»: vegetarian dishes stay.
    expect(recipeIdsBreakingRestrictions(pool, ['vegetariano'])).not.toContain('Verduras estofadas')
  })
})

describe('compound ingredient audit', () => {
  it('knows leftovers, stocks, cocido and generic cured meats, not «garbanzos cocidos»', () => {
    for (const n of ['Sobras del cocido madrileño', 'caldo de carne', 'Cocido', 'embutidos variados', 'fumet', 'paté de campaña', 'salchichas frescas']) {
      expect(isCompoundIngredientName(n), n).toBe(true)
    }
    for (const n of ['garbanzos cocidos', 'cebolla', 'pollo', 'chorizo oreado']) {
      expect(isCompoundIngredientName(n), n).toBe(false)
    }
  })

  it('lists compounds with no contains tag, most used first', () => {
    const rows = [
      { name: 'caldo de carne', containsTags: [], recipeCount: 1 },
      { name: 'sobras del cocido madrileño', containsTags: ['cerdo'], recipeCount: 3 },
      { name: 'fumet', containsTags: null, recipeCount: 4 },
      { name: 'cebolla', containsTags: [], recipeCount: 40 },
    ]
    expect(compoundIngredientsWithoutTags(rows).map((r) => r.name)).toEqual(['fumet', 'caldo de carne'])
  })

  it('every known label uses allowed tags', () => {
    const allowed = new Set<string>(CONTAINS_TAGS)
    for (const n of ['sobras del cocido madrileño', 'caldo de cocido', 'salchichas frescas', 'foie gras de untar']) {
      const tags = knownCompoundTags(n)
      expect(tags, n).not.toBeNull()
      for (const t of tags!) expect(allowed.has(t), t).toBe(true)
    }
  })
})

describe('applyCompoundIngredientTags', () => {
  function fakeDb(rows: Array<{ id: string; name: string; containsTags: string[] }>) {
    const updates: Array<{ containsTags: string[] }> = []
    const db = {
      select: () => ({ from: async () => rows }),
      update: () => ({ set: (v: { containsTags: string[] }) => ({ where: async () => { updates.push(v) } }) }),
    }
    return { db: db as never, updates }
  }

  it('labels known compounds only while they have no tag (a label from Cocina stays)', async () => {
    const { db, updates } = fakeDb([
      { id: '1', name: 'sobras del cocido madrileño', containsTags: [] },
      { id: '2', name: 'caldo de cocido', containsTags: ['cerdo', 'ternera'] },
      { id: '3', name: 'cebolla', containsTags: [] },
    ])
    const res = await applyCompoundIngredientTags(db, () => {})
    expect(updates).toHaveLength(1)
    expect(updates[0].containsTags).toEqual(['cerdo', 'ternera', 'pollo', 'gluten'])
    expect(res.set).toHaveLength(1)
  })
})
