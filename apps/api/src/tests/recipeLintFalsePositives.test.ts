/**
 * PRO-289 — the reviewer (recipeLint) rejected 26 of the 32 recipes of the
 * Cocina batch `cocina-01` (2026-10-20), almost all wrongly. One test per
 * line of that log (the steps are invented sentences that reproduce each
 * pattern, never the batch's text), plus what the reviewer must keep catching.
 *
 * Run: cd apps/api && npx vitest run src/tests/recipeLintFalsePositives.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  lintRecipe,
  sameWord,
  type CatalogIngredient,
  type LintIssue,
  type RecipeInput,
} from '../services/recipeLint.js'
import type { Unit } from '@ona/shared'

// The catalogue words that misfired, next to the recipes' own ingredients.
const NAMES = [
  // single words that misfired
  'pollo', 'pavo', 'cerdo', 'pulpo', 'pera', 'dorada', 'pasas', 'pasta', 'sardinas', 'lechuga', 'agua', 'sal',
  'huevo', 'huevos', 'laurel', 'chorizo', 'morcilla', 'mango', 'cebolla', 'merluza', 'agua de azahar', 'picada',
  'rallado', 'dorado',
  'zumo de limón', 'dientes de ajo', 'salsa de tomate',
  // the recipes' own ingredients
  'lentejas pardinas', 'arroz', 'pimiento rojo', 'pimiento verde', 'alubias pintas cocidas', 'garbanzos cocidos',
  'calabaza', 'judiones cocidos', 'patata', 'bacalao desalado', 'pimiento choricero', 'pan blanco', 'tomate triturado',
  'mejillones', 'muslos de pollo', 'limón', 'carne picada de pollo', 'pan rallado', 'leche entera', 'espaguetis',
  'zanahoria', 'lomo de cerdo', 'caldo de pollo', 'naranja', 'alcachofa', 'jamón serrano', 'lombarda', 'setas variadas',
  'boniato', 'tomate', 'copos de avena', 'plátano', 'manzana', 'lentejas cocidas', 'cebolla morada', 'coliflor',
  'pechuga de pavo', 'leche de coco', 'calabacín', 'carne picada mixta', 'guisantes', 'lubina', 'contramuslos de pollo',
  'judías verdes', 'judiones', 'panceta', 'ajo', 'aceite de oliva virgen extra', 'espinacas frescas', 'perejil fresco',
] as const

const catId = (name: string) => `cat:${name}`
const CATALOG: CatalogIngredient[] = NAMES.map((name, i) => ({ id: catId(name), name, fdcId: 1000 + i, density: 1 }))

type Line = [name: (typeof NAMES)[number], quantity: number, unit?: Unit]

/** A recipe for `servings`; the first step references every row so ORPHAN never fires. */
function recipe(lines: Line[], steps: string[], servings = 4): RecipeInput {
  const ingredients = lines.map(([name, quantity, unit = 'g'], i) => ({
    id: `row-${i}`,
    ingredientId: catId(name),
    quantity,
    unit,
  }))
  return {
    name: 'Receta de prueba',
    servings,
    equipment: ['cazuela'],
    ingredients,
    steps: steps.map((text, i) => ({
      index: i,
      text,
      ingredientRefs: i === 0 ? ingredients.map(r => r.id) : [],
    })),
  }
}

const lint = (r: RecipeInput) => lintRecipe(r, { ingredientCatalog: CATALOG })
const notListed = (errors: LintIssue[]) =>
  errors.filter(e => e.code === 'STEP_INGREDIENT_NOT_LISTED').map(e => e.message.match(/menciona "([^"]+)"/)![1])
const outOfRange = (errors: LintIssue[]) =>
  errors.filter(e => e.code === 'QUANTITY_OUT_OF_RANGE').map(e => e.message.match(/de "([^"]+)"/)![1])

// ─── The 26 lines of the log ─────────────────────────────────────

describe('PRO-289 — tanda cocina-01: lo que el revisor rechazó por error', () => {
  const CASES: Array<[string, RecipeInput]> = [
    ['Lentejas con arroz y verduras (agua; sardinas en «pardinas»; arroz 20 g; pimiento rojo 25 g)', recipe(
      [['lentejas pardinas', 280], ['arroz', 80], ['pimiento rojo', 100]],
      ['Sofríe el pimiento.', 'Cubre con agua fría y lleva a ebullición.', 'Echa las lentejas pardinas lavadas.',
        'Añade el arroz cuando las pardinas estén casi hechas.', 'Deja reposar: las pardinas terminan con el calor.'],
    )],
    ['Alubias pintas con verduras (agua; pimiento verde 20 g)', recipe(
      [['alubias pintas cocidas', 800], ['pimiento verde', 80]],
      ['Rehoga el pimiento.', 'Incorpora las alubias.', 'Cubre con un poco de agua.', 'Añade agua si hace falta.'],
    )],
    ['Garbanzos guisados con calabaza («pera» en «pero» y en «espera»)', recipe(
      [['garbanzos cocidos', 700], ['calabaza', 500]],
      ['Cuece la calabaza.', 'Añade los garbanzos.', 'Espera a que hierva de nuevo.', 'Remueve.',
        'Prueba de sal, pero sin pasarte.'],
    )],
    ['Judiones estofados (pimiento rojo 25 g)', recipe(
      [['judiones', 800], ['pimiento rojo', 100]],
      ['Rehoga el pimiento.', 'Incorpora los judiones.'],
    )],
    ['Merluza a la gallega (cebolla 25 g)', recipe(
      [['merluza', 600], ['patata', 600], ['cebolla', 100]],
      ['Cuece las patatas con la cebolla.', 'Añade la merluza.'],
    )],
    ['Dorada al horno con patatas panaderas (pimiento verde 25 g)', recipe(
      [['dorada', 800], ['patata', 700], ['pimiento verde', 100]],
      ['Hornea las patatas con el pimiento.', 'Coloca las doradas encima.'],
    )],
    ['Bacalao a la vizcaína (pulpo en «pulpa»; el verbo «pasas»; agua; «dorada» adjetivo; pan blanco 5 g)', recipe(
      [['bacalao desalado', 600], ['pimiento choricero', 6, 'u'], ['cebolla', 300], ['pan blanco', 20]],
      ['Hidrata los pimientos choriceros en agua templada, saca la pulpa y luego la pasas por un colador fino.',
        'Pocha la cebolla.', 'Sigue hasta que la cebolla esté dorada y añade el pan.',
        'Tritura con la pulpa de los pimientos y pon el bacalao.'],
    )],
    ['Mejillones a la marinera (375 g por ración, con concha)', recipe(
      [['mejillones', 1500], ['cebolla', 150]],
      ['Abre los mejillones al vapor.', 'Pocha la cebolla.'],
    )],
    ['Pollo asado con patatas y limón («pollo» con «muslos de pollo»; «dorada» adjetivo)', recipe(
      [['muslos de pollo', 1000], ['patata', 700], ['limón', 1, 'u']],
      ['Saca el pollo del frigorífico.', 'Coloca el pollo sobre las patatas.',
        'Hornea hasta que la piel esté dorada y crujiente.', 'Sirve con el limón.'],
    )],
    ['Albóndigas de pollo con tomate («pollo» con «carne picada de pollo»; pan rallado 13 g; leche 13 ml; cebolla 25 g)', recipe(
      [['carne picada de pollo', 600], ['pan rallado', 50], ['leche entera', 50, 'ml'], ['cebolla', 100]],
      ['Moja el pan rallado en la leche.', 'Añade el pollo y forma bolas del tamaño de una nuez.', 'Pocha la cebolla.'],
    )],
    ['Espaguetis a la boloñesa (agua; zanahoria 25 g)', recipe(
      [['espaguetis', 360], ['carne picada mixta', 400], ['zanahoria', 100]],
      ['Rehoga la zanahoria.', 'Añade la carne.', 'Cuece la pasta en abundante agua con sal y escúrrela.'],
    )],
    ['Lomo de cerdo a la naranja («cerdo» con «lomo de cerdo»; «pollo» con «caldo de pollo»)', recipe(
      [['lomo de cerdo', 600], ['naranja', 3, 'u'], ['caldo de pollo', 100, 'ml']],
      ['Dora los filetes.', 'Marca el cerdo por los dos lados.', 'Añade el zumo de naranja.', 'Reduce.',
        'Moja con el caldo de pollo.'],
    )],
    ['Alcachofas con jamón (agua en dos pasos)', recipe(
      [['alcachofa', 8, 'u'], ['jamón serrano', 100], ['limón', 1, 'u']],
      ['Limpia las alcachofas.', 'Déjalas en agua con zumo de limón.', 'Cuécelas en agua con sal.', 'Añade el jamón.'],
    )],
    ['Lombarda rehogada con manzana (agua; cebolla 25 g)', recipe(
      [['lombarda', 800], ['cebolla', 100], ['pasas', 30]],
      ['Cuece la lombarda en agua con sal.', 'Dora la cebolla.', 'Añade las pasas.'],
    )],
    ['Revuelto de setas («pera» en «pero»)', recipe(
      [['setas variadas', 400], ['huevo', 6, 'u']],
      ['Saltea las setas.', 'Añade los huevos.', 'Retira cuando estén cuajados pero jugosos.'],
    )],
    ['Boniato asado relleno de garbanzos (pulpo en «pulpa»)', recipe(
      [['boniato', 4, 'u'], ['garbanzos cocidos', 400]],
      ['Asa los boniatos.', 'Abre los boniatos y aplasta un poco la pulpa con los garbanzos.'],
    )],
    ['Tostadas con tomate y aceite («dorada» adjetivo; pulpo en «pulpa»)', recipe(
      [['pan blanco', 320], ['tomate', 2, 'u']],
      ['Tuesta el pan hasta que la superficie quede dorada.', 'Ralla los tomates y extiende la pulpa sobre el pan.'],
    )],
    ['Tortitas de avena y plátano («pasta» en el sentido de masa, tres pasos)', recipe(
      [['copos de avena', 160], ['plátano', 2, 'u'], ['huevo', 2, 'u'], ['leche entera', 200, 'ml']],
      ['Tritura la avena con el plátano, el huevo y la leche hasta tener una pasta espesa.',
        'Deja reposar la pasta cinco minutos.', 'Echa un cucharón de la pasta en la sartén y cocina dos minutos.',
        'Repite con el resto de la pasta.'],
    )],
    ['Manzanas asadas (pulpo en «pulpa»)', recipe(
      [['manzana', 4, 'u']],
      ['Vacía las manzanas.', 'Hornea hasta que la pulpa esté blanda.'],
    )],
    ['Ensalada de lentejas (pimiento rojo 25 g; cebolla morada 15 g)', recipe(
      [['lentejas cocidas', 600], ['pimiento rojo', 100], ['cebolla morada', 60]],
      ['Mezcla las lentejas con el pimiento y la cebolla.'],
    )],
    ['Crema de coliflor (leche entera 25 ml)', recipe(
      [['coliflor', 800], ['leche entera', 100, 'ml']],
      ['Cuece la coliflor.', 'Tritura con la leche.'],
    )],
    ['Pavo al curry con arroz («pavo» con «pechuga de pavo»; «lechuga» en «pechuga»; «pollo» con «caldo de pollo»)', recipe(
      [['pechuga de pavo', 600], ['arroz', 240], ['leche de coco', 200, 'ml'], ['caldo de pollo', 150, 'ml']],
      ['Cuece el arroz.', 'Corta la pechuga en dados y sala el pavo.', 'Dora el pavo.', 'Añade la leche de coco.',
        'Moja con el caldo de pollo.', 'Vuelve a poner el pavo.'],
    )],
    ['Calabacines rellenos de carne (pulpo en «pulpa» dos veces; cebolla 25 g)', recipe(
      [['calabacín', 4, 'u'], ['carne picada mixta', 400], ['cebolla', 100]],
      ['Vacía los calabacines y pica la pulpa.', 'Sofríe la cebolla con la carne y la pulpa.'],
    )],
    ['Huevos al plato con tomate y guisantes (cebolla 25 g)', recipe(
      [['huevo', 8, 'u'], ['guisantes', 200], ['cebolla', 100]],
      ['Pocha la cebolla con los guisantes.', 'Casca los huevos encima.'],
    )],
    ['Lubina a la plancha con verduras salteadas («dorada» adjetivo; cebolla 25 g)', recipe(
      [['lubina', 600], ['cebolla', 100]],
      ['Saltea la cebolla.', 'Pon la lubina con la piel hacia abajo hasta que quede dorada y crujiente.'],
    )],
    ['Arroz caldoso de pollo y verduras («pollo» con «contramuslos de pollo»; judías verdes 38 g; pimiento rojo 25 g)', recipe(
      [['arroz', 280], ['contramuslos de pollo', 500], ['judías verdes', 150], ['pimiento rojo', 100]],
      ['Dora el pollo con las judías y el pimiento.', 'Añade el arroz.', 'Cuece hasta que el pollo esté tierno.'],
    )],
  ]

  it.each(CASES)('%s → pasa', (_name, r) => {
    const { errors } = lint(r)
    expect(errors).toEqual([])
  })

  it('el log tiene 26 rechazos y cada uno es un caso', () => {
    expect(CASES).toHaveLength(26)
  })
})

// ─── What the reviewer must keep catching ───────────────────────

describe('PRO-289 — lo que el revisor sigue cazando', () => {
  const base: Line[] = [['judiones', 800], ['panceta', 100], ['cebolla', 120]]

  it('un chorizo y una morcilla que salen en los pasos y no en la lista', () => {
    const { errors } = lint(recipe(base, ['Dora la panceta.', 'Añade el chorizo y la morcilla en rodajas.', 'Echa los judiones.']))
    expect(notListed(errors).sort()).toEqual(['chorizo', 'morcilla'])
  })

  it('el pollo cuando la lista no tiene ningún pollo', () => {
    const { errors } = lint(recipe([['patata', 600]], ['Pela las patatas.', 'Dora el pollo y resérvalo.']))
    expect(notListed(errors)).toEqual(['pollo'])
  })

  it('la dorada como pescado (con artículo, número o «de»), aunque no esté listada', () => {
    for (const step of ['Coloca la dorada sobre las patatas.', 'Sala las doradas por dentro.', 'Compra dos doradas de ración.', 'Pon los lomos de dorada.']) {
      expect(notListed(lint(recipe([['patata', 600]], ['Pela las patatas.', step])).errors), step).toEqual(['dorada'])
    }
  })

  it('adjetivos y participios no son el ingrediente («salsa picada», «queso rallado», «bien dorado»); con artículo, sí', () => {
    const steps = ['Marca la merluza hasta que quede bien dorado el lomo.', 'Cubre con queso rallado y gratina.', 'Sirve con una salsa picada fina.']
    expect(notListed(lint(recipe([['merluza', 600]], steps)).errors)).toEqual([])
    expect(notListed(lint(recipe([['merluza', 600]], [...steps, 'Añade la picada de almendras.'])).errors)).toEqual(['picada'])
  })

  it('las pasas como fruta seca', () => {
    expect(notListed(lint(recipe(base, ['Dora la panceta.', 'Añade las pasas y remueve.'])).errors)).toEqual(['pasas'])
  })

  it('la pasta cuando se cuece y no hay ninguna pasta en la lista', () => {
    const { errors } = lint(recipe(base, ['Dora la panceta.', 'Cuece la pasta en agua con sal y escúrrela.']))
    expect(notListed(errors)).toEqual(['pasta'])
  })

  it('la pera, el pulpo y la lechuga cuando se nombran de verdad', () => {
    const { errors } = lint(recipe(base, ['Dora la panceta.', 'Pela la pera.', 'Cuece el pulpo.', 'Sirve sobre unas hojas de lechuga.']))
    expect(notListed(errors).sort()).toEqual(['lechuga', 'pera', 'pulpo'])
  })

  it('el mango como fruta, no el de la sartén', () => {
    expect(notListed(lint(recipe(base, ['Sujeta la sartén por el mango.', 'Coge el mango de la cazuela.'])).errors)).toEqual([])
    expect(notListed(lint(recipe(base, ['Dora la panceta.', 'Pela el mango.'])).errors)).toEqual(['mango'])
  })

  it('un agua que se compra («agua de azahar») sí hay que listarla; el agua y la sal, no', () => {
    const { errors } = lint(recipe(base, ['Cubre con agua y sal.', 'Perfuma con agua de azahar.']))
    expect(notListed(errors)).toEqual(['agua de azahar'])
  })

  it('«zumo de limón», «dientes de ajo» y «salsa de tomate» valen si está lo de dentro; si no, saltan', () => {
    const steps = ['Pela los dientes de ajo.', 'Riega con el zumo de limón.', 'Cubre con la salsa de tomate.']
    expect(notListed(lint(recipe([['ajo', 2, 'u'], ['limón', 1, 'u'], ['tomate triturado', 400]], steps)).errors)).toEqual([])
    expect(notListed(lint(recipe([['patata', 600]], ['Pela las patatas.', ...steps])).errors).sort()).toEqual([
      'ajo', 'dientes de ajo', 'limón', 'salsa de tomate', 'tomate', 'zumo de limón',
    ])
  })

  it('una ración de proteína demasiado pequeña', () => {
    const tiny = lint(recipe([['pollo', 100], ['merluza', 200]], ['Dora el pollo y la merluza.']))
    expect(outOfRange(tiny.errors).sort()).toEqual(['merluza', 'pollo'])
  })

  it('el mínimo de aderezo sigue cazando una errata de unidades', () => {
    const typo = lint(recipe([['cebolla', 1], ['leche entera', 10, 'ml'], ['pimiento rojo', 2]], ['Pocha la cebolla con el pimiento y la leche.']))
    expect(outOfRange(typo.errors).sort()).toEqual(['cebolla', 'leche entera', 'pimiento rojo'])
  })

  it('mejillones: 375 g por ración pasa, 625 g no', () => {
    expect(outOfRange(lint(recipe([['mejillones', 1500]], ['Abre los mejillones.'])).errors)).toEqual([])
    expect(outOfRange(lint(recipe([['mejillones', 2500]], ['Abre los mejillones.'])).errors)).toEqual(['mejillones'])
  })

  it('judías verdes son verdura, no la legumbre seca: 38 g pasan y 5 kg no', () => {
    expect(outOfRange(lint(recipe([['judías verdes', 150]], ['Saltea las judías.'])).errors)).toEqual([])
    expect(outOfRange(lint(recipe([['judías verdes', 5000]], ['Saltea las judías.'])).errors)).toEqual(['judías verdes'])
  })
})

describe('sameWord — singular y plural, nunca género ni erratas', () => {
  it.each([
    ['pollo', 'pollos'], ['limon', 'limones'], ['pasa', 'pasas'], ['dorada', 'doradas'], ['cebolla', 'cebollas'],
  ])('%s = %s', (a, b) => {
    expect(sameWord(a, b)).toBe(true)
    expect(sameWord(b, a)).toBe(true)
  })
  it.each([
    ['pulpo', 'pulpa'], ['pera', 'pero'], ['pera', 'espera'], ['dorada', 'dorado'], ['sardinas', 'pardinas'],
    ['lechuga', 'pechuga'], ['nueces', 'nuez'],
  ])('%s ≠ %s', (a, b) => {
    expect(sameWord(a, b)).toBe(false)
  })
})
