/**
 * PRO-78 — «Arroz al caldero» had only «Arroz, Ajo» in the catalogue, so it
 * reached vegetarian weeks. The seed now carries its real ingredients and a
 * boot-time data fix brings existing catalogues in line.
 */
import { describe, expect, it } from 'vitest'
import { seedIngredients } from '../seed/ingredients.js'
import { seedRecipes } from '../seed/recipes.js'
import {
  ARROZ_AL_CALDERO,
  arrozAlCalderoIngredients,
  needsArrozCalderoFix,
} from '../services/catalogRecipeFixes.js'
import { compileRestrictions, violatesRestrictions } from '../services/dietaryRestrictions.js'
import { allergenUnion } from '../services/nutrition/allergens.js'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import type { Season } from '@ona/shared'
import catalog from './fixtures/catalog-2026-10-12.json'

const ingredientByName = new Map(seedIngredients.map((i) => [i.name, i]))

/** The seed recipe as the menu filter sees it (names + catalogue allergen tags). */
function catalogRecipe(name: string) {
  const seed = seedRecipes.find((r) => r.name === name)
  if (!seed) throw new Error(`no seed recipe ${name}`)
  const ingredients = seed.ingredients.map((ri) => ({
    ingredientId: ri.name,
    ingredientName: ri.name,
    allergenTags: ((ingredientByName.get(ri.name) as { allergenTags?: string[] } | undefined)?.allergenTags ?? []) as string[],
  }))
  const allergens = allergenUnion(
    ingredients,
    new Map(ingredients.map((i) => [i.ingredientId, { allergenTags: i.allergenTags }])),
  )
  return { allergens, ingredients }
}

describe('«Arroz al caldero» in the catalogue', () => {
  it('lists the ingredients Miguel approved (respuesta A)', () => {
    expect(arrozAlCalderoIngredients()).toEqual([
      { name: 'arroz', quantity: 500, unit: 'g' },
      { name: 'ñora', quantity: 5, unit: 'u' },
      { name: 'caldo de pescado', quantity: 1500, unit: 'ml' },
      { name: 'lubina', quantity: 600, unit: 'g' },
      { name: 'tomate concentrado', quantity: 30, unit: 'g' },
      { name: 'ajo', quantity: 15, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 60, unit: 'ml' },
      { name: 'alioli', quantity: 100, unit: 'g' },
    ])
  })

  it('every ingredient exists in the seed catalogue, so the seed never drops one', () => {
    for (const i of arrozAlCalderoIngredients()) expect(ingredientByName.has(i.name), i.name).toBe(true)
  })

  it('carries fish (and egg from the alioli) in its allergens', () => {
    const r = catalogRecipe(ARROZ_AL_CALDERO)
    expect(r.allergens).toContain('pescado')
    expect(r.allergens).toContain('huevo')
  })

  it('is not vegetarian, nor fit for «sin pescado»; still fine for «sin gluten»', () => {
    const r = catalogRecipe(ARROZ_AL_CALDERO)
    expect(violatesRestrictions(r, compileRestrictions(['vegetariano']))).toBe(true)
    expect(violatesRestrictions(r, compileRestrictions(['vegano']))).toBe(true)
    expect(violatesRestrictions(r, compileRestrictions(['pescado']))).toBe(true)
    expect(violatesRestrictions(r, compileRestrictions(['huevo']))).toBe(true)
    expect(violatesRestrictions(r, compileRestrictions(['sin gluten']))).toBe(false)
  })

  it('the new ingredients carry the right allergen tags', () => {
    const tags = (n: string) => (ingredientByName.get(n) as { allergenTags?: string[] }).allergenTags
    expect(tags('lubina')).toEqual(['pescado'])
    expect(tags('caldo de pescado')).toEqual(['apio', 'pescado']) // PRO-363
    expect(tags('alioli')).toEqual(['huevo'])
    expect(tags('ñora')).toEqual([])
    expect(tags('tomate concentrado')).toEqual([])
  })
})

describe('needsArrozCalderoFix (boot-time data fix guard)', () => {
  it('only fires while the recipe still has exactly «Arroz, Ajo»', () => {
    expect(needsArrozCalderoFix(['arroz', 'ajo'])).toBe(true)
    expect(needsArrozCalderoFix(['Ajo', 'Arroz'])).toBe(true)
  })

  it('leaves a recipe someone already fixed or edited alone (idempotent)', () => {
    expect(needsArrozCalderoFix(arrozAlCalderoIngredients().map((i) => i.name))).toBe(false)
    expect(needsArrozCalderoFix(['arroz', 'ajo', 'gambas'])).toBe(false)
    expect(needsArrozCalderoFix(['arroz'])).toBe(false)
    expect(needsArrozCalderoFix(['arroz', 'arroz'])).toBe(false)
    expect(needsArrozCalderoFix([])).toBe(false)
  })
})

describe('the real catalogue (2026-10-12 snapshot of production)', () => {
  const fixture = catalog as Array<{ name: string; meals: string[]; seasons: string[]; mealFit: any; seasonFit: any; allergens: string[]; ingredients: string[] }>
  const before = fixture.find((r) => r.name === ARROZ_AL_CALDERO)!

  it('still has the broken «Arroz, Ajo», so the boot fix fires there', () => {
    expect(before.ingredients).toEqual(['arroz', 'ajo'])
    expect(needsArrozCalderoFix(before.ingredients)).toBe(true)
  })

  it('after the fix, no «vegetariano» week (any season, several tries) serves it', () => {
    const fixed = catalogRecipe(ARROZ_AL_CALDERO)
    const pool: RecipeWithCourse[] = fixture.map((r, i) => {
      const isTarget = r.name === ARROZ_AL_CALDERO
      return {
        id: `r${i}`,
        name: r.name,
        meals: r.meals,
        seasons: r.seasons,
        mealFit: r.mealFit ?? undefined,
        seasonFit: r.seasonFit ?? undefined,
        frequency: null,
        tags: [],
        allergens: isTarget ? fixed.allergens : r.allergens,
        course: null,
        ingredients: isTarget
          ? fixed.ingredients.map((ing, j) => ({ ingredientId: `i${i}-${j}`, ingredientName: ing.ingredientName, quantity: 100, unit: 'g', allergenTags: ing.allergenTags }))
          : r.ingredients.map((n, j) => ({ ingredientId: `i${i}-${j}`, ingredientName: n, quantity: 100, unit: 'g', allergenTags: [] })),
      }
    })
    // Five tries per season over the whole catalogue: it would surface if the
    // filter let it through (it reaches unrestricted weeks, checked below).
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as Season[]) {
      for (let i = 0; i < 5; i++) {
        const { days } = buildRandomMenu(defaultTemplate(), pool, season, ['vegetariano'], new Set(), {})
        const names = days.flatMap((d) => Object.values(d).flatMap((slot) => (slot?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeName] : []))))
        expect(names.length).toBeGreaterThan(0)
        expect(names).not.toContain(ARROZ_AL_CALDERO)
      }
    }
    // Without restrictions it is still on the menu's pool (the fix doesn't hide it).
    const all = buildRandomMenu(defaultTemplate(), pool.filter((r) => r.name === ARROZ_AL_CALDERO), 'autumn', [], new Set(), {})
    const served = all.days.flatMap((d) => Object.values(d).flatMap((slot) => (slot?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeName] : []))))
    expect(served).toContain(ARROZ_AL_CALDERO)
  }, 30_000)
})
