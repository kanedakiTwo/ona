/**
 * PRO-73 — catalogue recipes with no steps or with quantities that make no
 * sense (75 g of chicken for two, one egg in a tortilla for two, 25 g of
 * pasta per person) are skipped by the menu generator until Cocina fixes
 * them. The rule is computed in code (catalogRecipeAudit.ts); nothing is
 * written to the database.
 *
 * `fixtures/catalog-quantities-2026-10-15.json` is the system catalogue as
 * staging (a copy of production's) served it on 2026-10-15: name, servings,
 * meals, seasons, fit maps, allergens, number of steps and ingredient lines.
 * `course` comes from scripts/output/recipe-courses.jsonl (null if missing).
 */
import { describe, expect, it } from 'vitest'
import catalog from './fixtures/catalog-quantities-2026-10-15.json'
import {
  auditCatalogRecipe,
  catalogAuditIssuesFor,
  isMainProtein,
  isStarchBase,
  lineGrams,
  type AuditableRecipe,
} from '../services/catalogRecipeAudit.js'
import { matchRecipes } from '../services/recipeMatcher.js'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import type { Course, Season } from '@ona/shared'
import { seedRecipes } from '../seed/recipes.js'

const STEPS = 5
const recipe = (servings: number, ingredients: AuditableRecipe['ingredients'], stepCount = STEPS): AuditableRecipe => ({
  name: 'x',
  servings,
  stepCount,
  ingredients,
})
const g = (name: string, quantity: number, unit = 'g') => ({ name, quantity, unit })

describe('auditCatalogRecipe — the hogares de prueba examples', () => {
  it('«Pollo a la plancha con brocoli»: 75 g of chicken for two and no steps', () => {
    const r = auditCatalogRecipe(recipe(2, [g('pollo', 75), g('brocoli', 100), g('aceite de oliva virgen', 10)], 0))
    expect(r.issues).toEqual(['sin_pasos', 'proteina_fuera_de_rango'])
    expect(r.proteinPerServingG).toBe(38)
  })

  it('«Arroz al caldero»: only rice and garlic', () => {
    expect(auditCatalogRecipe(recipe(2, [g('arroz', 250), g('ajo', 1.5)], 0)).issues).toEqual(['sin_pasos', 'pocos_ingredientes'])
  })

  it('«Tortilla de patatas»: 60 g of egg for two', () => {
    expect(auditCatalogRecipe(recipe(2, [g('huevo', 60), g('patata', 250), g('cebolla', 100)])).issues).toEqual(['proteina_fuera_de_rango'])
  })

  it('«Riñones al jerez»: 1000 g of kidneys for two', () => {
    const r = auditCatalogRecipe(recipe(2, [g('riñones de cerdo', 1000), g('vino de jerez', 100, 'ml'), g('cebolla', 100)]))
    expect(r.issues).toEqual(['proteina_fuera_de_rango'])
    expect(r.proteinPerServingG).toBe(500)
  })

  it('«Espaguetis con ajo y aceite»: 25 g of pasta per serving', () => {
    const r = auditCatalogRecipe(recipe(4, [g('pasta', 100), g('ajo', 10), g('aceite de oliva virgen', 40, 'ml'), g('perejil', 5)]))
    expect(r.issues).toEqual(['base_fuera_de_rango'])
    expect(r.starchPerServingG).toBe(25)
  })

  it('a sensible recipe passes', () => {
    const r = auditCatalogRecipe(recipe(4, [g('pollo', 600), g('arroz', 320), g('pimiento rojo', 150), g('cebolla', 100)]))
    expect(r.issues).toEqual([])
    expect(r.proteinPerServingG).toBe(150)
    expect(r.starchPerServingG).toBe(80)
  })

  it('edges: exactly 80 / 300 g and 50 / 150 g are fine', () => {
    expect(auditCatalogRecipe(recipe(1, [g('pollo', 80), g('pasta', 50), g('tomate', 100)])).issues).toEqual([])
    expect(auditCatalogRecipe(recipe(1, [g('pollo', 300), g('pasta', 150), g('tomate', 100)])).issues).toEqual([])
    expect(auditCatalogRecipe(recipe(1, [g('pollo', 79), g('pasta', 151), g('tomate', 100)])).issues).toEqual([
      'proteina_fuera_de_rango',
      'base_fuera_de_rango',
    ])
  })
})

describe('what counts', () => {
  it('main protein: meat, fish, seafood, eggs, tofu; not stocks, sauces, cured garnish or yolks', () => {
    for (const n of ['pollo', 'Muslo de pollo', 'riñones de cerdo', 'Salmón', 'gambas', 'huevos', 'tofu', 'entraña de ternera']) {
      expect(isMainProtein(n), n).toBe(true)
    }
    for (const n of ['caldo de pollo', 'salsa de pescado', 'jamón serrano fileteado', 'chorizo oreado', 'yema de huevo', 'harina de garbanzo', 'cebolla']) {
      expect(isMainProtein(n), n).toBe(false)
    }
  })

  it('base: pasta, rice, dry pulses; not cooked/canned pulses, green beans, flours or rice vinegar', () => {
    for (const n of ['arroz', 'arroz de grano largo', 'pasta', 'fideos', 'lentejas', 'garbanzos', 'judias rojas']) {
      expect(isStarchBase(n), n).toBe(true)
    }
    for (const n of ['garbanzos cocidos', 'judias verdes', 'harina de arroz', 'vinagre de arroz', 'lentejas en conserva']) {
      expect(isStarchBase(n), n).toBe(false)
    }
  })

  it('grams: g, ml (density or 1), units with a known weight; eggs default to 55 g; unknown → null', () => {
    expect(lineGrams(g('pollo', 200))).toBe(200)
    expect(lineGrams({ ...g('leche', 100, 'ml'), density: 1.03 })).toBeCloseTo(103)
    expect(lineGrams({ ...g('dorada', 2, 'u'), unitWeight: 400 })).toBe(800)
    expect(lineGrams(g('huevo', 2, 'u'))).toBe(110)
    expect(lineGrams(g('dorada', 2, 'u'))).toBeNull()
    expect(lineGrams(g('pollo', 1, 'al_gusto'))).toBeNull()
  })

  it('an unknown weight never flags the range', () => {
    expect(auditCatalogRecipe(recipe(4, [g('dorada', 2, 'u'), g('tomate', 200), g('cebolla', 100)])).issues).toEqual([])
  })
})

describe('the menu matcher skips flagged catalogue recipes', () => {
  const base = { meals: ['lunch'], seasons: [], tags: [], allergens: [], ingredients: [] }
  const opts = { meal: 'lunch' as const, season: 'autumn' as const, usedRecipeIds: new Set<string>(), restrictions: [], favoriteRecipeIds: new Set<string>() }

  it('a recipe with audit issues is out; one without is in', () => {
    const out = matchRecipes(
      [
        { ...base, id: 'bad', name: 'Sin pasos', catalogAuditIssues: ['sin_pasos'] },
        { ...base, id: 'ok', name: 'Bien', catalogAuditIssues: [] },
        { ...base, id: 'legacy', name: 'Sin calcular' },
      ],
      opts,
    )
    expect(out.map((r) => r.id)).toEqual(['ok', 'legacy'])
  })

  it('users\' own recipes are never audited (their quantities are theirs)', () => {
    const stepless = recipe(2, [g('pollo', 50)], 0)
    expect(catalogAuditIssuesFor('user-1', stepless)).toEqual([])
    expect(catalogAuditIssuesFor(null, stepless)).toEqual(['sin_pasos', 'pocos_ingredientes', 'proteina_fuera_de_rango'])
  })
})

// ─── The real catalogue ──────────────────────────────────────────

interface FixtureRecipe extends AuditableRecipe {
  meals: string[]
  seasons: string[]
  mealFit: Record<string, 'mid' | 'perfect'> | null
  seasonFit: Record<string, 'mid' | 'perfect'> | null
  frequency: string | null
  course: Course | null
  allergens: string[]
}
const fixture = catalog as FixtureRecipe[]

/** Read by hand on 2026-10-13 (PRO-73): the 17 catalogue recipes without steps and the 3 with ≤ 2 ingredients. */
const NO_STEPS = [
  'Espaguetis con ajo y aceite', 'Pollo a la plancha con brocoli', 'Tortilla de patatas', 'Salmon al horno con patatas',
  'Lentejas estofadas', 'Ensalada de atun', 'Revuelto de calabacin', 'Arroz con pollo', 'Tostadas con aguacate y huevo',
  'Porridge de avena con platano', 'Crema de zanahoria', 'Ternera con pimientos', 'Coliflor gratinada',
  'Yogur con avena y manzana', 'Arroz al caldero', 'Carrilleras de ternera con vino tinto', 'Pescado a la espalda en la brasa',
]
const FEW_INGREDIENTS = ['Arroz al caldero', 'Bacalao con tomate', 'Melón con jamón']

function poolFrom(recipes: FixtureRecipe[]): RecipeWithCourse[] {
  return recipes.map((r, i) => ({
    id: `r${i}`,
    name: r.name,
    meals: r.meals,
    seasons: r.seasons,
    mealFit: r.mealFit ?? undefined,
    seasonFit: r.seasonFit ?? undefined,
    frequency: null,
    tags: [],
    allergens: r.allergens,
    course: r.course,
    ingredients: r.ingredients.map((ing, j) => ({ ingredientId: `i${i}-${j}`, ingredientName: ing.name, quantity: ing.quantity, unit: ing.unit, allergenTags: [] })),
    // Same call loadMatchableRecipes makes (system recipes: authorId null).
    catalogAuditIssues: catalogAuditIssuesFor(null, r),
  }))
}

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
const DIETS: string[][] = [[], ['vegetariano'], ['sin gluten'], ['vegetariano', 'sin gluten']]

function week(pool: RecipeWithCourse[], season: Season, restrictions: string[]) {
  const { days, warnings } = buildRandomMenu(defaultTemplate(), pool, season, restrictions, new Set(), {})
  const names = days.flatMap((d) => Object.values(d).flatMap((slot) => (slot?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeName] : []))))
  return { names, warnings }
}

describe('the real catalogue (staging, copy of production, 2026-10-15)', () => {
  const pool = poolFrom(fixture)
  const flagged = new Set(pool.filter((r) => (r.catalogAuditIssues ?? []).length > 0).map((r) => r.name))

  it('flags every recipe without steps and every one with 2 ingredients or fewer', () => {
    expect(NO_STEPS.filter((n) => !flagged.has(n))).toEqual([])
    expect(FEW_INGREDIENTS.filter((n) => !flagged.has(n))).toEqual([])
  })

  it('flags 32 of the 78 recipes (the list Cocina reviews)', () => {
    expect(fixture.length).toBe(78)
    expect(flagged.size).toBe(32)
  })

  it('generated weeks never serve a flagged recipe', () => {
    for (const season of SEASONS) {
      for (const diet of DIETS) {
        for (let i = 0; i < 3; i++) {
          const { names } = week(pool, season, diet)
          expect(names.filter((n) => flagged.has(n)), `${season} ${diet.join('+')}`).toEqual([])
        }
      }
    }
  }, 60_000)

  // Measured 2026-10-15 with this fixture (lunch + dinner slots filled out of
  // 14, before → after the gate): no restrictions 14 → 14 every season;
  // autumn vegetariano 14 → 14, sin gluten 14 → 14, both 13 → 10; winter
  // vegetariano 14 → 13, both 12 → 9; spring/summer vegetariano 13 → 9,
  // sin gluten 14 → 13, both 9 → 6. The vegetarian gaps close as Cocina fixes
  // the stepless vegetarian recipes (tortilla, revuelto, espaguetis…).
  it('without them there are still enough recipes for full weeks: every season with no restrictions; autumn also vegetarian or gluten-free', () => {
    const cases: Array<[Season, string[]]> = [
      ...SEASONS.map((s): [Season, string[]] => [s, []]),
      ['autumn', ['vegetariano']],
      ['autumn', ['sin gluten']],
    ]
    for (const [season, diet] of cases) {
      for (let i = 0; i < 3; i++) {
        const { names, warnings } = week(pool, season, diet)
        expect(warnings, `${season} ${diet.join('+') || 'sin restricciones'}`).toEqual([])
        expect(names).toHaveLength(14)
      }
    }
  }, 60_000)
})

// ─── New catalogue recipes must have steps ──────────────────────

/**
 * The legacy seed (`seed/recipes.ts`) still has these 65 recipes without
 * steps (most also without ingredients, so `db:seed` skips them). The list
 * can only shrink: a new seed recipe without steps fails here. The other ways
 * into the catalogue (`apply:recipes`, «Añadir al catálogo» from a link)
 * persist through `lintRecipe`, whose NO_STEPS error blocks them
 * (recipeLint.test.ts).
 */
const SEED_WITHOUT_STEPS_2026_10_15 = [
  'Arroz al caldero', 'Carrilleras de ternera con vino tinto', 'Lubina', 'Espaguetti carbonara', 'Cocido N',
  'Sushi en bowl', 'Huevos al plato', 'Arroz con conejo', 'Fidegua gipsy', 'Berenjenas con chermoula',
  'Sandwich mixto', 'Osobuco a la milanesa', 'Pechuga pollo baja temperatura', 'Lasana',
  'Salmon al horno con brocoli', 'Crema zanahorias', 'Crema de calabaza', 'Pastela vegetariana Gipsy', 'Pizza',
  'Muslos de pavo a la catalana', 'Pisto (Shakshuka)', 'Aguachile de salmon', 'Ensalada thai de ternera', 'Migas',
  'Arroz mexicano', 'Paella de sepia y gambas', 'Arroz al horno', 'Tian de verduras', 'Wok de ternera y verduras',
  'Cochinita pibil', 'Pescado al horno', 'Pollo al mole', 'Romanescu', 'Cinta de lomo con brocoli',
  'Tiradito de bacalao', 'Magret pekinesa', 'Salteado de salmon', 'Tacos gipsy', 'Quesadillas de sobrasada',
  'Arroz con bacalao', 'Alitas de pollo', 'Vichisoisse', 'Dorada a la marsellesa', 'Verduras estofadas',
  'Sopa Juliana', 'Onigirazu Sandwich de sushi', 'Espinacas a la crema', 'Curry de patatas y guisantes',
  'Wrap de lechuga con noodles', 'Berenjenas rellenas', 'Fajitas de pollo', 'Ramen', 'Sopa Miso',
  'Vegan butter chicken', 'Tzatziki', 'Contramuslos de pollo guisados', 'Tabule', 'Berenjenas con queso',
  'Pollo agridulce gipsy', 'Lasana de verduras', 'Tajin de verduras y cordero', 'Albondigas gipsy',
  'Garbanzos con sobrasada', 'Ensalada thai', 'Revuelto de espinacas y atun',
]

describe('catalogue recipes need steps', () => {
  it('no new seed recipe without steps', () => {
    const known = new Set(SEED_WITHOUT_STEPS_2026_10_15)
    const newOnes = seedRecipes.filter((r) => r.steps.length === 0 && !known.has(r.name)).map((r) => r.name)
    expect(newOnes, 'add its steps (or ask Cocina) instead of adding it to the list').toEqual([])
  })

  it('the list only shrinks: a recipe that got its steps leaves it', () => {
    const byName = new Map(seedRecipes.map((r) => [r.name, r]))
    const fixed = SEED_WITHOUT_STEPS_2026_10_15.filter((n) => (byName.get(n)?.steps.length ?? 0) > 0)
    expect(fixed, 'remove these from SEED_WITHOUT_STEPS_2026_10_15').toEqual([])
  })
})
