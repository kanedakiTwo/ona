/**
 * PRO-61 — allergies and diets over the whole catalogue.
 *
 * The fixture is the system catalogue as it was on 2026-10-12 (78 recipes:
 * name, meals, seasons, stored allergens, ingredient names), read from the
 * public catalogue on staging, which is production's. The hogares de prueba
 * got «Costillas a la riojana» («Costillas») and «Ropa vieja del cocido»
 * («Sobras del cocido madrileño») with «vegetariano», and «Pizza de colores
 * con verduras» («Harina de fuerza») and «Arroz tres delicias» («Salsa de
 * soja») with «sin gluten», whose ficha didn't say «Gluten» either.
 *
 * The expected lists below were written by reading each recipe's
 * ingredients, not by running the filter.
 */
import { describe, expect, it } from 'vitest'
import catalog from './fixtures/catalog-2026-10-12.json'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import { compileRestrictions, recipeIdsBreakingRestrictions, violatesRestrictions } from '../services/dietaryRestrictions.js'
import { effectiveAllergens } from '../services/nutrition/allergens.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import type { Season } from '@ona/shared'

interface FixtureRecipe {
  name: string
  meals: string[]
  seasons: string[]
  mealFit: Record<string, 'mid' | 'perfect'> | null
  seasonFit: Record<string, 'mid' | 'perfect'> | null
  frequency: string | null
  allergens: string[]
  ingredients: string[]
}

const fixture = catalog as FixtureRecipe[]

const pool: RecipeWithCourse[] = fixture.map((r, i) => ({
  id: `r${i}`,
  name: r.name,
  meals: r.meals,
  seasons: r.seasons,
  mealFit: r.mealFit ?? undefined,
  seasonFit: r.seasonFit ?? undefined,
  // Weekend-only recipes stay out of Mon-Fri; irrelevant here.
  frequency: null,
  tags: [],
  allergens: r.allergens,
  course: null,
  ingredients: r.ingredients.map((n, j) => ({ ingredientId: `i${i}-${j}`, ingredientName: n, quantity: 100, unit: 'g', allergenTags: [] })),
}))

/** Meat or fish in the ingredients (read by hand). */
const NOT_VEGETARIAN = [
  'Albondigas en salsa espanola', 'Albóndigas gipsy', 'Alitas de pollo al horno',
  'Alubias rojas con entraña y embutidos', 'Arroz al horno', 'Arroz con bacalao', 'Arroz con pollo',
  'Arroz tres delicias', 'Avgolemono (sopa griega de limón)', 'Bacalao con tomate', 'Berenjenas rellenas',
  'Boquerones fritos', 'Carrilleras de ternera con vino tinto', 'Ceviche', 'Cocido madrileno',
  'Conejo confitado con ajo y romero', 'Contramuslos de pollo guisados', 'Costillas a la riojana',
  'Crema de zanahoria con pollo, aguacate y granada', 'Dorada a la marsellesa', 'Ensalada de atun',
  'Fajitas de pollo', 'Guisantes lagrima', 'Hamburguesa perfecta de Gipsy Chef', 'Melón con jamón',
  'Menestra de verduras con carne', 'Onigirazu', 'Oreja a la plancha', 'Pescado a la espalda en la brasa',
  'Pisto con huevo frito a la Thermomix', 'Pollo a la plancha con brocoli', 'Pollo agridulce',
  'Ramen casero', 'Revuelto de espinacas y atún', 'Riñones al jerez', 'Ropa vieja del cocido',
  'Saam de pollo, mango y mandarina', 'Salmon al horno con patatas',
  'Salteado de verduras con salmón marinado', 'Sandwich vegetal', 'Steak Tartar', 'Sándwich mixto',
  'Tajín de verduras y cordero', 'Ternera a la jardinera', 'Ternera con pimientos',
  'Wrap de lechuga con noodles',
]

/** Vegetarian recipes that must stay available (the filter can't just hide everything). */
const VEGETARIAN = [
  'Acelgas rehogadas', 'Berenjenas con queso', 'Crema de calabacin', 'Curry de berenjena',
  'Curry de patatas y guisantes', 'Espaguetis con ajo y aceite', 'Falafel', 'Hummus casero',
  'Lentejas guisadas', 'Pizza de colores con verduras', 'Tortilla de patatas',
  'Vegan butter chicken (con tofu)', 'Verduras estofadas',
]

/** Wheat, flour, bread, pasta, noodles, oats, couscous, soy sauce or Worcestershire (read by hand). */
const HAS_GLUTEN = [
  'Albondigas en salsa espanola', 'Albóndigas gipsy', 'Alitas de pollo al horno', 'Arroz tres delicias',
  'Boquerones fritos', 'Coliflor gratinada', 'Conejo confitado con ajo y romero', 'Ensalada griega',
  'Ensalada thai', 'Espaguetis con ajo y aceite', 'Falafel', 'Garbanzos con espinacas',
  'Hamburguesa perfecta de Gipsy Chef', 'Lasaña de verduras', 'Onigirazu', 'Pizza de colores con verduras',
  'Pollo agridulce', 'Porridge de avena con platano', 'Ramen casero', 'Saam de pollo, mango y mandarina',
  'Salteado de verduras con salmón marinado', 'Sandwich vegetal', 'Sopa miso', 'Steak Tartar',
  'Sándwich mixto', 'Tabulé', 'Tostadas con aguacate y huevo', 'Wrap de lechuga con noodles',
  'Yogur con avena y manzana',
]

const GLUTEN_FREE = [
  'Acelgas rehogadas', 'Arroz con pollo', 'Ceviche', 'Crema de calabacin', 'Curry de berenjena',
  'Fajitas de pollo', 'Hummus casero', 'Lentejas guisadas', 'Tortilla de patatas',
  'Vegan butter chicken (con tofu)',
]

/** PRO-144: an alcoholic drink among the ingredients or in the name (read by hand). */
const HAS_ALCOHOL = [
  'Carrilleras de ternera con vino tinto', 'Conejo confitado con ajo y romero', 'Contramuslos de pollo guisados',
  'Dorada a la marsellesa', 'Riñones al jerez',
]

/** «Vinagre de vino» is not alcohol: these stay. */
const WINE_VINEGAR_ONLY = ['Garbanzos con espinacas', 'Onigirazu', 'Pollo agridulce']

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']

function generatedNames(restrictions: string[], season: Season): string[] {
  const { days } = buildRandomMenu(defaultTemplate(), pool, season, restrictions, new Set(), {})
  const names: string[] = []
  for (const day of days) {
    for (const slot of Object.values(day)) {
      for (const dish of slot?.dishes ?? []) if (dish.kind === 'recipe') names.push(dish.recipeName)
    }
  }
  return names
}

describe('fixture', () => {
  it('every hand-written name is in the catalogue', () => {
    const names = new Set(fixture.map((r) => r.name))
    for (const n of [...NOT_VEGETARIAN, ...VEGETARIAN, ...HAS_GLUTEN, ...GLUTEN_FREE, ...HAS_ALCOHOL, ...WINE_VINEGAR_ONLY]) expect(names.has(n), n).toBe(true)
  })
})

describe('«vegetariano» over the whole catalogue', () => {
  const rules = compileRestrictions(['vegetariano'])
  const byName = new Map(pool.map((r) => [r.name, r]))

  it('excludes every recipe with meat or fish (costillas, sobras del cocido, oreja, riñones…)', () => {
    const missed = NOT_VEGETARIAN.filter((n) => !violatesRestrictions(byName.get(n)!, rules))
    expect(missed).toEqual([])
  })

  it('keeps the vegetarian ones', () => {
    expect(VEGETARIAN.filter((n) => violatesRestrictions(byName.get(n)!, rules))).toEqual([])
  })

  it('generated weeks (every season, several tries) never contain meat or fish', () => {
    for (const season of SEASONS) {
      for (let i = 0; i < 5; i++) {
        const names = generatedNames(['vegetariano'], season)
        expect(names.length).toBeGreaterThan(0)
        expect(names.filter((n) => NOT_VEGETARIAN.includes(n)), `${season} #${i}`).toEqual([])
      }
    }
  })

  it('the «Elegir otra receta» list (fitsMe) hides the same recipes', () => {
    const hidden = new Set(recipeIdsBreakingRestrictions(pool, ['vegetariano']))
    const hiddenNames = pool.filter((r) => hidden.has(r.id)).map((r) => r.name)
    expect(NOT_VEGETARIAN.filter((n) => !hiddenNames.includes(n))).toEqual([])
    expect(VEGETARIAN.filter((n) => hiddenNames.includes(n))).toEqual([])
    expect(recipeIdsBreakingRestrictions(pool, [])).toEqual([])
  })
})

describe('«sin gluten» over the whole catalogue', () => {
  const rules = compileRestrictions(['Sin gluten'])
  const byName = new Map(pool.map((r) => [r.name, r]))

  it('excludes every recipe with wheat, «harina de fuerza», pasta, noodles or soy sauce', () => {
    expect(HAS_GLUTEN.filter((n) => !violatesRestrictions(byName.get(n)!, rules))).toEqual([])
  })

  it('keeps gluten-free ones', () => {
    expect(GLUTEN_FREE.filter((n) => violatesRestrictions(byName.get(n)!, rules))).toEqual([])
  })

  it('generated weeks never contain gluten', () => {
    for (const season of SEASONS) {
      for (let i = 0; i < 5; i++) {
        const names = generatedNames(['sin gluten'], season)
        expect(names.length).toBeGreaterThan(0)
        expect(names.filter((n) => HAS_GLUTEN.includes(n)), `${season} #${i}`).toEqual([])
      }
    }
  })
})

describe('PRO-144 — «sin alcohol» over the whole catalogue', () => {
  const rules = compileRestrictions(['sin alcohol'])
  const byName = new Map(pool.map((r) => [r.name, r]))

  it('excludes exactly the recipes with wine, sherry… (and keeps the ones with wine vinegar)', () => {
    const hidden = pool.filter((r) => violatesRestrictions(r, rules)).map((r) => r.name).sort()
    expect(hidden).toEqual([...HAS_ALCOHOL].sort())
    expect(WINE_VINEGAR_ONLY.filter((n) => violatesRestrictions(byName.get(n)!, rules))).toEqual([])
  })

  it('generated weeks never contain them', () => {
    for (const season of SEASONS) {
      for (let i = 0; i < 5; i++) {
        const names = generatedNames(['sin alcohol'], season)
        expect(names.length).toBeGreaterThan(0)
        expect(names.filter((n) => HAS_ALCOHOL.includes(n)), `${season} #${i}`).toEqual([])
      }
    }
  })

  it('the «Elegir otra receta» list (fitsMe) hides the same recipes', () => {
    const hidden = new Set(recipeIdsBreakingRestrictions(pool, ['sin alcohol']))
    expect(pool.filter((r) => hidden.has(r.id)).map((r) => r.name).sort()).toEqual([...HAS_ALCOHOL].sort())
  })
})

describe('allergens on the ficha (effectiveAllergens) over the whole catalogue', () => {
  const eff = new Map(fixture.map((r) => [r.name, effectiveAllergens(r.allergens, r.ingredients)]))

  it('«Pizza de colores» and «Arroz tres delicias» now say gluten', () => {
    expect(eff.get('Pizza de colores con verduras')).toContain('gluten')
    expect(eff.get('Arroz tres delicias')).toContain('gluten')
  })

  it('every recipe with gluten says so', () => {
    expect(HAS_GLUTEN.filter((n) => !eff.get(n)!.includes('gluten'))).toEqual([])
  })

  it('never drops a stored tag', () => {
    for (const r of fixture) for (const t of r.allergens) expect(eff.get(r.name), r.name).toContain(t)
  })

  it('does not invent gluten for gluten-free recipes', () => {
    expect(GLUTEN_FREE.filter((n) => eff.get(n)!.includes('gluten'))).toEqual([])
  })
})
