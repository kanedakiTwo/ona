/**
 * PRO-197 (beta 2026-10-17): «Afina tu menú» showed a coeliac pizza, ramen
 * and espaguetis, and a vegetarian cocido, bacalao and pollo. The cards now
 * go through the menu generator's own filter (`violatesRestrictions`) with
 * the restrictions and ingredient vetoes of every member of the household.
 * Over the 78-recipe catalogue fixture.
 */
import { describe, expect, it } from 'vitest'
import catalog from './fixtures/catalog-2026-10-12.json'
import { breaksTasteRules, householdTasteRules } from '../services/tasteStore.js'
import { compileRestrictions, violatesRestrictions } from '../services/dietaryRestrictions.js'

const recipes = (catalog as any[]).map((r) => ({
  name: r.name as string,
  allergens: (r.allergens ?? []) as string[],
  ingredients: (r.ingredients as string[]).map((n) => ({ ingredientName: n })),
}))

function visibleNames(members: Parameters<typeof householdTasteRules>[0]): string[] {
  const rules = householdTasteRules(members)
  return recipes.filter((r) => !breaksTasteRules(r, rules)).map((r) => r.name)
}

describe('«Afina tu menú» respects the household restrictions (PRO-197)', () => {
  it('a coeliac household (memory «soy celíaco» on one member) never sees gluten', () => {
    const names = visibleNames([
      { restrictions: [], memory: { restrictions: { value: ['soy celíaco'] } } },
      { restrictions: [], memory: null },
    ])
    for (const banned of ['Pizza de colores con verduras', 'Espaguetis con ajo y aceite', 'Ramen casero', 'Boquerones fritos', 'Falafel', 'Pollo agridulce']) {
      expect(names).not.toContain(banned)
    }
    expect(names).toContain('Lentejas guisadas')
    // Nothing left that the generator's gluten rule would refuse.
    const gluten = compileRestrictions(['sin gluten'])
    expect(recipes.filter((r) => names.includes(r.name)).some((r) => violatesRestrictions(r, gluten))).toBe(false)
  })

  it('a vegetarian in the profile of the partner hides meat and fish for the whole household', () => {
    const names = visibleNames([
      { restrictions: [], memory: null },
      { restrictions: ['Vegetariano'], memory: null },
    ])
    for (const banned of [
      'Cocido madrileno', 'Bacalao con tomate', 'Arroz con pollo', 'Ramen casero', 'Avgolemono (sopa griega de limón)',
      'Oreja a la plancha', 'Steak Tartar', 'Carrilleras de ternera con vino tinto', 'Ropa vieja del cocido', 'Salmon al horno con patatas',
    ]) {
      expect(names).not.toContain(banned)
    }
    expect(names).toContain('Curry de berenjena')
    expect(names.length).toBeGreaterThan(10)
  })

  it('ingredient vetoes (dislikes) of any member count: «patata»', () => {
    const names = visibleNames([{ restrictions: [], memory: { dislikes: { value: ['patata'] } } }])
    expect(names).not.toContain('Lentejas estofadas')
    expect(names).not.toContain('Salmon al horno con patatas')
    expect(names).toContain('Lentejas guisadas')
  })

  it('profile and memory merge like the generator (mergeRestrictions); no restriction = whole catalogue', () => {
    expect(visibleNames([{ restrictions: [], memory: null }])).toHaveLength(recipes.length)
    const both = visibleNames([{ restrictions: ['Sin gluten'], memory: { restrictions: { value: ['vegetariana'] } } }])
    expect(both).not.toContain('Falafel')
    expect(both).not.toContain('Arroz con pollo')
  })

  it('«soy vegetariana» told to Mimo counts as the diet', () => {
    const names = visibleNames([{ restrictions: [], memory: { restrictions: { value: ['soy vegetariana'] } } }])
    expect(names).not.toContain('Arroz con pollo')
    expect(names).not.toContain('Bacalao con tomate')
  })

  it('the card shows the name, so the name counts too (an ingredient list that lost the cod)', () => {
    const rules = householdTasteRules([{ restrictions: ['Vegetariano'] }])
    const bare = { name: 'Bacalao con tomate', allergens: [], ingredients: [{ ingredientName: 'tomate' }] }
    expect(violatesRestrictions(bare, rules)).toBe(false) // the menu's own check misses it…
    expect(breaksTasteRules(bare, rules)).toBe(true) // …the cards don't
    expect(breaksTasteRules({ name: 'Garbanzos cocidos con espinacas', allergens: [], ingredients: [] }, rules)).toBe(false)
  })

  it('«sin alcohol» also reads the recipe name, as in the menu', () => {
    const names = visibleNames([{ restrictions: ['Sin alcohol'], memory: null }])
    expect(names).not.toContain('Carrilleras de ternera con vino tinto')
  })
})
