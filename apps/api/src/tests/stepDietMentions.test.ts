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

const terms = (steps: string[], names: string[], recipeName?: string) => unlistedDietMentions(steps, names, recipeName).map((m) => m.term)

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

/**
 * PRO-401 — the Jerusalem book (2026-10-25): the reviewer rejected 40 of 109
 * recipes for single words. From `catalogo-admin.log` and the audit of
 * 2026-11-18: «Pudin de yogur con melocotones … menciona "hueso" (carne)»,
 * «Ossobuco … menciona "dorada" (pescado)», «carne» for an aubergine's flesh,
 * «galleta» in «Galletas de tahini». The step sentences are rebuilt.
 */
describe('PRO-401: words that are not the ingredient', () => {
  it('«la carne» of a listed aubergine, tomato or avocado is its flesh', () => {
    expect(terms(['Saca la carne con una cuchara y mézclala con el yogur.'], ['berenjena', 'yogur natural'])).toEqual([])
    expect(terms(['Abre las berenjenas asadas, vacía la carne y escúrrela.'], ['berenjena'])).toEqual([])
    expect(terms(['Raspa la carne de los tomates rallados.'], ['tomate'])).toEqual([])
    expect(terms(['Parte los aguacates, retira el hueso y extrae la carne.'], ['aguacate', 'lima'])).toEqual([])
  })

  it('«el hueso» of a listed peach, apricot or olive is its stone', () => {
    expect(terms(['Parte los melocotones por la mitad y quita el hueso.'], ['melocotón', 'yogur griego', 'miel'])).toEqual([])
    expect(terms(['Retira los huesos y trocea la fruta.'], ['albaricoques secos'])).toEqual([])
    expect(terms(['Aplasta las aceitunas para sacarles el hueso.'], ['aceitunas negras'])).toEqual([])
  })

  it('«dorada» joined by «y» to another adjective is the colour', () => {
    const steps = [
      'Dora los jarretes hasta que la carne quede crujiente y dorada.',
      'Hornea hasta que la masa esté hinchada y dorada.',
      'Fríe las cebollas hasta que estén blandas y doradas.',
    ]
    expect(terms(steps, ['jarrete de ternera', 'cebolla', 'harina'])).toEqual([])
  })

  it('the dish of the title is not an unlisted ingredient', () => {
    const tahini = ['harina de trigo', 'mantequilla', 'azúcar', 'tahini', 'sésamo']
    expect(terms(['Forma las galletas y hornéalas 15 minutos.'], tahini, 'Galletas de tahini')).toEqual([])
    expect(terms(['Forma las hamburguesas y dóralas en la sartén.'], ['garbanzos cocidos', 'cebolla'], 'Hamburguesas de garbanzos')).toEqual([])
    expect(terms(['Forma las albóndigas con las manos húmedas.'], ['lentejas', 'pan rallado'], 'Albóndigas de lentejas')).toEqual([])
  })

  it('the real ones still come out: meat in a vegetarian recipe, an undeclared allergen', () => {
    // Meat: a fleshy vegetable listed doesn't hide meat named as meat.
    expect(terms(['Añade la carne picada al sofrito de tomate.'], ['tomate', 'cebolla'])).toEqual(['carne'])
    expect(terms(['Sofríe el tomate y añade la carne.'], ['tomate', 'cebolla'])).toEqual(['carne'])
    expect(terms(['Retira la carne picada de la sartén.'], ['berenjena'])).toEqual(['carne'])
    // A bone, with no stone fruit in the recipe (Lentejas guisadas).
    expect(terms(['Añadir huesos y pimentón.'], ['lentejas', 'zanahoria'])).toEqual(['hueso'])
    expect(terms(['Quita el hueso y desmenuza.'], ['lentejas'])).toEqual(['hueso'])
    // The fish, with an article.
    expect(terms(['Coloca la dorada en la bandeja.'], ['patata'])).toEqual(['dorada'])
    expect(terms(['Limpia la merluza y la dorada.'], ['patata'])).toEqual(['merluza', 'dorada'])
    // An allergen the title doesn't account for: biscuits for a cheesecake base, bread not listed.
    expect(terms(['Tritura las galletas con la mantequilla.'], ['queso crema', 'mantequilla', 'azúcar'], 'Tarta de queso')).toEqual(['galleta'])
    expect(terms(['Tuesta el pan y frota el tomate.'], ['tomate', 'aceite de oliva'], 'Pan con tomate')).toEqual(['pan'])
    expect(terms(['Forma las hamburguesas.'], ['cebolla'], 'Hamburguesas caseras')).toEqual(['hamburguesa'])
    // Steps with peanuts in a recipe that lists apricots.
    expect(terms(['Espolvorea cacahuetes picados.'], ['albaricoques'])).toEqual(['cacahuete'])
  })

  it('the reviewer passes «Galletas de tahini» and still blocks a cake with unlisted biscuits', () => {
    const catalog: CatalogIngredient[] = ['harina de trigo', 'mantequilla', 'azúcar', 'tahini'].map((name) => ({ id: `cat:${name}`, name, fdcId: 1, density: 1 }))
    const ingredients = catalog.map((c, i) => ({ id: `row-${i}`, ingredientId: c.id, quantity: 100, unit: 'g' as const }))
    const input = (name: string, steps: string[]): RecipeInput => ({
      name,
      servings: 4,
      equipment: ['horno'],
      ingredients,
      steps: steps.map((text, index) => ({ index, text, ingredientRefs: index === 0 ? ingredients.map((r) => r.id) : [] })),
    })
    const diet = (r: RecipeInput) => lintRecipe(r, { ingredientCatalog: catalog }).errors.filter((e) => e.code === 'STEP_DIET_INGREDIENT_NOT_LISTED')
    expect(diet(input('Galletas de tahini', ['Mezcla la harina de trigo, la mantequilla, el azúcar y el tahini.', 'Forma las galletas y hornéalas 15 minutos hasta que estén firmes y doradas.']))).toEqual([])
    expect(diet(input('Bizcocho de tahini', ['Mezcla la harina de trigo, la mantequilla, el azúcar y el tahini.', 'Sirve con unas almendras tostadas.'])).map((e) => e.path)).toEqual(['steps[1].text'])
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
