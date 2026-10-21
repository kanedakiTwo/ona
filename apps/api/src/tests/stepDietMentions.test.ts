/**
 * PRO-268 — steps that name meat, fish, shellfish or an allergen the recipe
 * doesn't list. «Lentejas guisadas» (catalogue, 2026-10-19): «Añadir huesos y
 * pimentón de la Vera», «añadir chorizo y morcilla», none of them listed.
 * The other sentences are invented.
 *
 * Run: cd apps/api && npx vitest run src/tests/stepDietMentions.test.ts
 */
import { describe, it, expect } from 'vitest'
import { unlistedDietMentions } from '../services/stepDietMentions.js'
import { auditStepMentions, renderStepMentionsReport } from '../services/stepDietMentionsAudit.js'
import { lintRecipe, type CatalogIngredient, type RecipeInput } from '../services/recipeLint.js'
import { seedRecipes } from '../seed/recipes.js'

const terms = (steps: string[], names: string[]) => unlistedDietMentions(steps, names).map((m) => m.term)

const LENTEJAS = seedRecipes.find((r) => r.name === 'Lentejas guisadas')!

describe('unlistedDietMentions', () => {
  it('Lentejas guisadas: huesos, chorizo y morcilla, que no están en los ingredientes', () => {
    const found = unlistedDietMentions(LENTEJAS.steps, LENTEJAS.ingredients.map((i) => i.name))
    expect(found.map((m) => [m.step + 1, m.term, m.category])).toEqual([
      [5, 'hueso', 'carne'],
      [8, 'chorizo', 'carne'],
      [8, 'morcilla', 'carne'],
    ])
    // With them listed, nothing.
    expect(terms(LENTEJAS.steps, [...LENTEJAS.ingredients.map((i) => i.name), 'chorizo', 'morcilla', 'hueso de jamón'])).toEqual([])
  })

  it('catches meat, fish, shellfish and allergens across categories', () => {
    const steps = [
      'Saltea las gambas.',
      'Añade un chorrito de salsa de soja.',
      'Espolvorea queso rallado por encima.',
      'Monta las claras a punto de nieve.',
      'Pasa los filetes por harina.',
      'Sirve con unas almendras tostadas y un poco de mostaza.',
      'Coloca la dorada en la bandeja.',
    ]
    const found = unlistedDietMentions(steps, ['cebolla'])
    expect(found.map((m) => `${m.term}:${m.category}`)).toEqual([
      'gamba:marisco', 'soja:soja', 'queso:lacteos', 'clara:huevo', 'filete:carne', 'harina:gluten',
      'almendra:frutos_secos', 'mostaza:mostaza', 'dorada:pescado',
    ])
  })

  it('what the recipe lists accounts for it', () => {
    expect(terms(['Añade el pollo desmenuzado.'], ['caldo de pollo'])).toEqual([])
    expect(terms(['Dora las pechugas.'], ['pollo'])).toEqual([])
    expect(terms(['Separa las claras de las yemas.'], ['huevos'])).toEqual([])
    expect(terms(['Limpia el pescado.'], ['merluza'])).toEqual([])
    expect(terms(['Riega con el vino.'], ['vinagre de vino'])).toEqual([])
    expect(terms(['Calienta la leche.'], ['leche de coco'])).toEqual([])
    expect(terms(['Forma las albóndigas.'], ['carne picada mixta'])).toEqual([])
    expect(terms(['Tuesta los frutos secos.'], ['nueces'])).toEqual([])
  })

  it("doesn't read a word as the food when it isn't", () => {
    const none = [
      'Pica las aceitunas sin hueso.',
      'Añade una pizca de nuez moscada.',
      'Vierte la leche de coco.',
      'Forma bolas del tamaño de una nuez.',
      'Funde una nuez de mantequilla en la sartén.',
      'Hornea hasta que esté dorada.',
      'Saca la carne del tomate con una cuchara.',
      'Retira los huesos de las aceitunas.',
      'Fríe hasta que quede bonito y crujiente.',
      'Deja que la salsa quede clara.',
    ]
    for (const s of none) expect(terms([s], ['tomate', 'aceitunas', 'mantequilla', 'leche de coco', 'patata']), s).toEqual([])
  })

  it('the rest of the specific meats still count with another meat listed (a pork-free home)', () => {
    expect(terms(['Añade el chorizo.'], ['pollo'])).toEqual(['chorizo'])
  })
})

describe('the reviewer (recipeLint) marks them in new recipes', () => {
  const NAMES = ['lentejas', 'zanahoria', 'ajo', 'cebolla', 'pimiento verde', 'tomate', 'aceite de oliva virgen', 'laurel', 'pimentón', 'chorizo']
  const CATALOG: CatalogIngredient[] = NAMES.map((name) => ({ id: `cat:${name}`, name, fdcId: 1, density: 1 }))
  const recipe = (steps: string[]): RecipeInput => {
    const listed = LENTEJAS.ingredients.map((i) => i.name).filter((n) => NAMES.includes(n))
    const ingredients = listed.map((name, i) => ({ id: `row-${i}`, ingredientId: `cat:${name}`, quantity: 100, unit: 'g' as const }))
    return {
      name: 'Lentejas guisadas',
      servings: 4,
      equipment: ['olla'],
      ingredients,
      steps: steps.map((text, index) => ({ index, text, ingredientRefs: index === 0 ? ingredients.map((r) => r.id) : [] })),
    }
  }

  it('«huesos y pimentón», chorizo y morcilla: blocked, each named once', () => {
    const { ok, errors } = lintRecipe(recipe(LENTEJAS.steps), { ingredientCatalog: CATALOG })
    expect(ok).toBe(false)
    const flagged = errors
      .filter((e) => e.code === 'STEP_INGREDIENT_NOT_LISTED' || e.code === 'STEP_DIET_INGREDIENT_NOT_LISTED')
      .map((e) => `${e.path} ${e.code} ${/menciona "([^"]+)"/.exec(e.message)![1]}`)
    expect(flagged.sort()).toEqual([
      'steps[3].text STEP_INGREDIENT_NOT_LISTED laurel', // also missing from the list
      'steps[4].text STEP_DIET_INGREDIENT_NOT_LISTED hueso',
      'steps[4].text STEP_INGREDIENT_NOT_LISTED pimentón',
      'steps[7].text STEP_DIET_INGREDIENT_NOT_LISTED morcilla',
      // chorizo is in this catalogue: the catalogue check names it, not twice.
      'steps[7].text STEP_INGREDIENT_NOT_LISTED chorizo',
    ])
    const diet = errors.find((e) => e.code === 'STEP_DIET_INGREDIENT_NOT_LISTED')!
    expect(diet.message).toContain('(carne)')
  })

  it('a clean recipe passes', () => {
    const { errors } = lintRecipe(recipe(['Sofríe la cebolla, el ajo, la zanahoria, el pimiento verde y el tomate en el aceite de oliva virgen.', 'Añade las lentejas, cubre con agua y cuece 40 minutos.']), { ingredientCatalog: CATALOG })
    expect(errors.filter((e) => e.code.startsWith('STEP_'))).toEqual([])
  })
})

describe('the catalogue pass (scripts/auditStepDietMentions.ts)', () => {
  it('lists the seed recipes with unlisted meat, Lentejas guisadas among them, and renders the report', () => {
    const recipes = seedRecipes.filter((r) => r.steps.length > 0).map((r) => ({ name: r.name, status: 'semilla', ingredients: r.ingredients.map((i) => i.name), steps: r.steps }))
    const audit = auditStepMentions(recipes, [...new Set(recipes.flatMap((r) => r.ingredients))])
    const lentejas = audit.diet.find((r) => r.name === 'Lentejas guisadas')!
    expect(lentejas.mentions.map((m) => `${m.step} ${m.term}`)).toEqual(['5 hueso', '8 chorizo', '8 morcilla'])
    const md = renderStepMentionsReport(audit, { date: '2026-10-21', source: 'prueba' })
    expect(md).toContain('| Lentejas guisadas | semilla | 5 | hueso | carne |')
    expect(md).toContain(`Recetas revisadas: **${recipes.length}**`)
  })
})
