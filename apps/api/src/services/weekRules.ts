/**
 * PRO-254 (D-087, tarea 2 del «Menú inteligente») — las reglas de una semana
 * bien hecha, como comprobaciones. Incluye PRO-238 (platos repetidos).
 *
 * Una función pura, `scoreWeek(days, recipes, opts)`, que puntúa una semana
 * con cada regla y dice qué huecos la incumplen. La usará el planificador a
 * la sombra (PRO-255) y la comparación a ciegas (PRO-256); hoy no cambia
 * ningún menú.
 *
 * Las reglas (COC-14, propuesta 2026-10-19-producto-menu-inteligente):
 *   1. `legumbre`            legumbre de cuchara al menos 2 veces;
 *   2. `pescado`             pescado o marisco 2 o 3 veces;
 *   3. `proteina_mismo_dia`  nunca la misma proteína principal a mediodía y
 *                            en la cena del mismo día;
 *   4. `plato_repetido`      el mismo plato no se repite en la semana, salvo
 *                            como sobras o táper (PRO-238);
 *   5. `aprovechar`          al menos un ingrediente fresco aprovechado en
 *                            dos platos distintos;
 *   6. `cenas_ligeras`       si el hogar lo ha pedido, cenas ligeras;
 *   7. `temporada`           todo de temporada;
 * y, blandas (restan poco y nunca avisan al hogar; COC-17, PRO-280):
 *   8. `verdura_diaria`      verdura u hortaliza (≥ 100 g por ración) en la
 *                            comida o la cena de cada día;
 *   9. `carne_roja`          carne roja o embutido como plato fuerte ≤ 2;
 *  10. `fritos`              fritos y rebozados ≤ 2;
 *  11. `largo_con_tiempo`    lo de más de 60 min, solo los días con tiempo.
 * Las definiciones son las de Cocina (`departments/cocina/reglas-semana.md`,
 * COC-14, PRO-280): legumbre y pescado cuentan solo como proteína principal,
 * por gramos por ración (o la etiqueta); «mismo plato» también por
 * ingrediente principal + tipo de plato; el queso es una familia; una crema
 * de legumbre sin carne ni embutido es ligera. Los umbrales están en
 * `WEEK_RULES_CONFIG` para cambiarlos sin tocar la lógica.
 */
import type { DayMenu, DayTimeBudget, Meal, Season } from '@ona/shared'
import { isInSeason, isTaperDish, recipeTotalMinutes } from '@ona/shared'
import { normalizeText } from './dietaryRestrictions.js'
import { lineGrams } from './catalogRecipeAudit.js'

export const WEEK_RULE_IDS = [
  'legumbre',
  'pescado',
  'proteina_mismo_dia',
  'plato_repetido',
  'aprovechar',
  'cenas_ligeras',
  'temporada',
  'verdura_diaria',
  'carne_roja',
  'fritos',
  'largo_con_tiempo',
] as const
export type WeekRuleId = (typeof WEEK_RULE_IDS)[number]

export const WEEK_RULES_CONFIG = {
  /** Legumbre de cuchara: al menos N veces por semana. */
  minLegumes: 2,
  /** Pescado o marisco: entre min y max veces. */
  minFish: 2,
  maxFish: 3,
  /** A partir de cuántos huecos de comida/cena se exigen legumbre y pescado. */
  minSlotsForCounts: 6,
  /** Una cena con más kcal por ración que esto no es ligera. */
  lightDinnerMaxKcal: 600,
  /** Ingredientes frescos compartidos que se piden (al menos uno). */
  sharedIngredientsTarget: 1,
  /** Legumbre como proteína principal: gramos por ración, en seco o cocida (Cocina). */
  legumeDryMinGrams: 50,
  legumeCookedMinGrams: 120,
  /** Pescado o marisco como plato fuerte: gramos comestibles por ración (Cocina). */
  fishMinGrams: 80,
  /** Carne, huevo, queso o tofu como plato fuerte: gramos por ración [I, Taller]. */
  proteinMinGrams: 60,
  /** Verdura u hortaliza de verdad en un plato: gramos por ración (Cocina, regla 8). */
  vegetableMinGrams: 100,
  /** Carne roja o embutido como plato fuerte: gramos comestibles por ración [I, Taller]. */
  redMeatMinGrams: 80,
  /** Como mucho, veces por semana (Cocina, reglas 9 y 10). */
  maxRedMeat: 2,
  maxFried: 2,
  /** Una receta «larga» pasa de estos minutos en total (Cocina, regla 11). */
  longRecipeMinutes: 60,
  /** Sin tiempos por día del hogar, los días con tiempo son el sábado y el domingo. */
  defaultDaysWithTime: [5, 6] as readonly number[],
  /** Peso de una regla blanda en la nota de la semana (una dura pesa 1) [I, Taller]. */
  softRuleWeight: 0.5,
} as const

/** Reglas blandas: restan poco, no cuentan para `ok` y nunca se avisan al hogar (COC-17). */
export const SOFT_WEEK_RULES: ReadonlySet<WeekRuleId> = new Set(['verdura_diaria', 'carne_roja', 'fritos', 'largo_con_tiempo'])

export const WEEK_RULE_LABEL: Record<WeekRuleId, string> = {
  legumbre: 'Legumbre de cuchara al menos 2 veces',
  pescado: 'Pescado 2 o 3 veces',
  proteina_mismo_dia: 'Sin la misma proteína a mediodía y en la cena',
  plato_repetido: 'Sin platos repetidos (salvo sobras o táper)',
  aprovechar: 'Un ingrediente aprovechado en dos platos',
  cenas_ligeras: 'Cenas ligeras',
  temporada: 'De temporada',
  verdura_diaria: 'Verdura todos los días',
  carne_roja: 'Carne roja o embutido, como mucho 2 veces',
  fritos: 'Fritos, como mucho 2',
  largo_con_tiempo: 'Lo largo, los días con tiempo',
}

/** What the rules need to know about a recipe (a `loadMatchableRecipes` row fits). */
export interface WeekRecipe {
  id: string
  name: string
  seasons?: string[]
  seasonFit?: Partial<Record<Season, unknown>> | null
  tags?: string[] | null
  /** `tipo:<slug>` and `proteina:<slug>` from the catalogue rewriter. */
  internalTags?: string[] | null
  /**
   * With quantity, unit and `servings` the rules measure grams per serving
   * (PRO-280): `unitWeight`, `density`, `edibleFraction` and the note as in
   * the catalogue audit (`lineGrams`). Without them they fall back to names.
   */
  ingredients: WeekIngredient[]
  servings?: number | null
  nutritionPerServing?: { kcal?: number | null } | null
  prepTime?: number | null
  cookTime?: number | null
  totalTime?: number | null
}

export interface WeekIngredient {
  ingredientName: string
  quantity?: number | null
  unit?: string | null
  unitWeight?: number | null
  density?: number | null
  edibleFraction?: number | null
  note?: string | null
  /** ingredients.aisle (`produce` = fruta y verdura). */
  aisle?: string | null
}

export interface WeekRuleSlotRef {
  dayIndex: number
  meal: string
  recipeId?: string
}

export interface WeekRuleResult {
  id: WeekRuleId
  /** False when the rule doesn't apply this week (too few meals, not asked, no fish allowed). */
  applies: boolean
  ok: boolean
  /** 0 (fails completely) … 1 (passes). */
  score: number
  /** Short Spanish detail for logs and the report («1 de 2», «martes: pollo y pollo»). */
  detail: string
  /** The slots that break it. */
  slots: WeekRuleSlotRef[]
  /** A soft rule (`SOFT_WEEK_RULES`): weighs less and doesn't count for the week's `ok`. */
  soft: boolean
}

export interface WeekScore {
  /** Weighted mean of the rules that apply, 0…1 (a soft rule weighs `softRuleWeight`). */
  score: number
  /** Every hard rule that applies passes. */
  ok: boolean
  rules: WeekRuleResult[]
}

export interface ScoreWeekOptions {
  season: Season
  /** The household asked for light dinners (ficha / memory, see `asksLightDinners`). */
  lightDinners?: boolean
  /** False for a household that can't eat fish (vegetarian, allergy): the fish rule doesn't apply. */
  fishAllowed?: boolean
  /** False for a household that can't eat pulses: the legume rule doesn't apply. */
  legumesAllowed?: boolean
  /**
   * The household's time per weekday (PRO-138, `timeBudgetsByDay`), for
   * `largo_con_tiempo`. A day without a limit has time; with none at all,
   * the days with time are `defaultDaysWithTime` (the weekend).
   */
  timeBudgetByDay?: Readonly<Record<number, DayTimeBudget | null | undefined>> | null
}

// ─── Classification (pure) ──────────────────────────────────────

const hasWord = (name: string, term: string) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}(e?s)?($|[^a-z0-9])`).test(name)
}
/** Names that contain a term but aren't the thing itself. */
const NOT_THE_THING = ['caldo', 'fondo', 'fumet', 'salsa', 'pastilla', 'concentrado', 'harina', 'vinagre', 'bebida de', 'leche de']

const LEGUME_TERMS = ['lenteja', 'garbanzo', 'alubia', 'judion', 'faba', 'frijol', 'azuki', 'soja texturizada', 'guisante seco', 'habas secas', 'hummus']
const NOT_A_LEGUME = ['judia verde', 'judias verdes', 'brote']
/** A legume already cooked (its threshold is the cooked one). */
const COOKED_LEGUME = /cocid|bote|conserva|en lata|tarro|hummus/
const FISH_TERMS = [
  'pescado', 'atun', 'bonito', 'salmon', 'bacalao', 'merluza', 'lubina', 'dorada', 'caballa', 'sardina',
  'boqueron', 'trucha', 'rape', 'rodaballo', 'lenguado', 'corvina', 'besugo', 'pescadilla', 'emperador',
  'pez espada', 'gamba', 'langostino', 'mejillon', 'almeja', 'pulpo', 'calamar', 'sepia', 'chipiron',
  'vieira', 'jurel', 'mero', 'abadejo', 'cazon', 'raya', 'perca', 'marisco', 'berberecho', 'navaja',
  'anchoa', 'ventresca', 'chirla', 'cigala',
]
/** Embutido: cerdo when it is the main of the dish (Cocina, regla 3), red/processed meat for rule 9. */
const CURED_TERMS = ['chorizo', 'morcilla', 'salchichon', 'fuet', 'sobrasada', 'butifarra', 'longaniza', 'lacon', 'beicon', 'bacon', 'tocino', 'jamon']
/** Main-protein families, in the order they are looked for when quantities are unknown. */
const PROTEIN_FAMILIES: Array<[string, string[]]> = [
  ['pescado', FISH_TERMS],
  ['pollo', ['pollo', 'pavo', 'pechuga', 'muslo', 'contramuslo', 'alitas', 'gallina']],
  ['ternera', ['ternera', 'vaca', 'buey', 'entrecot', 'chuleton', 'morcillo', 'rabo de toro', 'carrillera de ternera', 'carne picada']],
  ['cerdo', ['cerdo', 'secreto', 'presa', 'pluma', 'lomo', 'solomillo de cerdo', 'costilla', 'panceta', 'cochinita', 'salchicha', 'chorizo', 'morcilla', 'butifarra', 'longaniza', 'sobrasada']],
  ['cordero', ['cordero', 'cabrito']],
  ['conejo', ['conejo']],
  ['huevo', ['huevo']],
  ['legumbre', LEGUME_TERMS],
  ['tofu', ['tofu', 'tempeh', 'seitan']],
  ['queso', ['queso', 'burrata', 'mozzarella', 'feta', 'halloumi', 'requeson']],
]
/** Red and processed meat (rule 9): the red families, offal and embutido. */
const RED_MEAT_TERMS = [
  ...PROTEIN_FAMILIES.filter(([f]) => f === 'ternera' || f === 'cerdo' || f === 'cordero').flatMap(([, t]) => t),
  ...CURED_TERMS, 'carrillera', 'rinon', 'higado', 'callos', 'oreja', 'manitas', 'rabo',
]
const NOT_RED_MEAT = ['pollo', 'pavo', 'pato', 'conejo', 'pescado', 'jamon de pavo']
/** `proteina:<slug>` of the catalogue → family. */
const PROTEIN_TAG_FAMILY: Record<string, string> = {
  pollo: 'pollo', pavo: 'pollo', ternera: 'ternera', vaca: 'ternera', cerdo: 'cerdo', cordero: 'cordero',
  'pescado-blanco': 'pescado', 'pescado-azul': 'pescado', pescado: 'pescado', marisco: 'pescado',
  huevo: 'huevo', legumbre: 'legumbre', tofu: 'tofu', queso: 'queso', ninguna: 'ninguna',
}
const RED_FAMILIES = ['ternera', 'cerdo', 'cordero']
const HEAVY_DISH_TYPES = ['guiso', 'legumbre', 'arroz', 'pasta', 'frito', 'asado', 'estofado', 'cocido', 'fritura', 'lasana', 'pizza', 'potaje', 'fabada']
const LIGHT_DISH_TYPES = ['crema', 'sopa', 'ensalada', 'verdura', 'tortilla', 'revuelto', 'plancha', 'vapor', 'salteado', 'pure']
const FRIED_DISH_TYPES = ['frito', 'fritura']
/** Pantry basics: sharing them is not «aprovechar un ingrediente». */
const STAPLES = [
  'aceite', 'sal', 'pimienta', 'ajo', 'cebolla', 'agua', 'azucar', 'harina', 'vinagre', 'perejil', 'laurel',
  'pimenton', 'comino', 'oregano', 'tomillo', 'romero', 'caldo', 'mantequilla', 'leche', 'huevo', 'limon',
  'pan rallado', 'especias', 'nuez moscada', 'canela', 'curry', 'mostaza', 'tomate frito', 'vino', 'cebolleta',
]
/** In the produce aisle but not «verdura u hortaliza» for rule 8: fruit, tubers, aromatics. */
const NOT_A_VEGETABLE = [
  'patata', 'boniato', 'batata', 'yuca', 'ajo', 'perejil', 'cilantro', 'albahaca', 'hierbabuena', 'menta', 'eneldo',
  'cebollino', 'jengibre', 'guindilla', 'limon', 'lima', 'naranja', 'mandarina', 'pomelo', 'manzana', 'pera',
  'platano', 'fresa', 'frambuesa', 'arandano', 'uva', 'melon', 'sandia', 'melocoton', 'nectarina', 'albaricoque',
  'ciruela', 'cereza', 'kiwi', 'pina', 'mango', 'papaya', 'higo', 'granada', 'membrillo', 'coco', 'datil', 'aguacate',
]
/** Vegetables outside the produce aisle (frozen, jarred) or without an aisle. */
const VEGETABLE_TERMS = [
  'acelga', 'alcachofa', 'berenjena', 'brocoli', 'calabacin', 'calabaza', 'cebolla', 'col', 'coliflor', 'repollo',
  'endivia', 'escarola', 'esparrago', 'espinaca', 'guisante', 'judia verde', 'judias verdes', 'lechuga', 'canonigo',
  'rucula', 'nabo', 'pepino', 'pimiento', 'puerro', 'remolacha', 'seta', 'champinon', 'tomate', 'zanahoria',
  'apio', 'borraja', 'cardo', 'grelo', 'kale', 'lombarda', 'haba', 'hinojo', 'rabano', 'chirivia', 'verdura', 'menestra',
]
const FRIED_NAME = /\b(frit[oa]s?|fritura|rebozad[oa]s?|tempura|croquetas?|bunuelos?|a la romana|san jacobos?|flamenquin(es)?)\b|\bempanad[oa]s?\b(?<!^empanad[oa]s?)/

const tagValue = (r: WeekRecipe, prefix: string) => (r.internalTags ?? []).find((t) => t.startsWith(prefix))?.slice(prefix.length) ?? null
const ingNames = (r: WeekRecipe) => r.ingredients.map((i) => normalizeText(i.ingredientName))
const isLegumeName = (n: string) => !NOT_THE_THING.some((x) => n.includes(x)) && !NOT_A_LEGUME.some((x) => n.includes(x)) && LEGUME_TERMS.some((t) => hasWord(n, t))
const isFishName = (n: string) => !NOT_THE_THING.some((x) => n.includes(x)) && FISH_TERMS.some((t) => hasWord(n, t))
const isRedMeatName = (n: string) => !NOT_THE_THING.some((x) => n.includes(x)) && !NOT_RED_MEAT.some((x) => n.includes(x)) && !isFishName(n) && RED_MEAT_TERMS.some((t) => hasWord(n, t))
const isVegetable = (i: WeekIngredient) => {
  const n = normalizeText(i.ingredientName)
  if (NOT_THE_THING.some((x) => n.includes(x)) || NOT_A_VEGETABLE.some((t) => hasWord(n, t))) return false
  return i.aisle === 'produce' || VEGETABLE_TERMS.some((t) => hasWord(n, t))
}

/**
 * Pure: edible grams per serving of one line (`lineGrams`: units, density,
 * edible share and its note), or null when the recipe or the line doesn't
 * say enough (no servings, quantity or a convertible unit).
 */
export function gramsPerServing(r: WeekRecipe, i: WeekIngredient): number | null {
  if (!(typeof r.servings === 'number' && r.servings > 0) || i.quantity == null || !i.unit) return null
  const g = lineGrams({ name: i.ingredientName, quantity: i.quantity, unit: i.unit, unitWeight: i.unitWeight, density: i.density, edibleFraction: i.edibleFraction, note: i.note })
  if (g != null) return g / r.servings
  // cda, cdita, pizca, al gusto: a seasoning, never a main.
  return ['cda', 'cdita', 'pizca', 'al_gusto'].includes(i.unit) ? 0 : null
}

/** Sum of grams per serving of the lines that match, or null when one of them can't be measured. */
function sumGrams(r: WeekRecipe, match: (i: WeekIngredient, n: string) => boolean): number | null {
  let total = 0
  for (const i of r.ingredients) {
    if (!match(i, normalizeText(i.ingredientName))) continue
    const g = gramsPerServing(r, i)
    if (g == null) return null
    total += g
  }
  return total
}

/** How far a family's grams per serving reach its threshold (≥ 1 = it is the main), or null when unknown. */
function familyReach(r: WeekRecipe, family: string, terms: string[]): number | null {
  const cfg = WEEK_RULES_CONFIG
  if (family === 'legumbre') {
    let reach = 0
    for (const i of r.ingredients) {
      const n = normalizeText(i.ingredientName)
      if (!isLegumeName(n)) continue
      const g = gramsPerServing(r, i)
      if (g == null) return null
      reach += g / (COOKED_LEGUME.test(n) ? cfg.legumeCookedMinGrams : cfg.legumeDryMinGrams)
    }
    return reach
  }
  const match = family === 'pescado'
    ? (_: WeekIngredient, n: string) => isFishName(n)
    : (_: WeekIngredient, n: string) => !NOT_THE_THING.some((x) => n.includes(x)) && terms.some((t) => hasWord(n, t))
  const g = sumGrams(r, match)
  if (g == null) return null
  return g / (family === 'pescado' ? cfg.fishMinGrams : cfg.proteinMinGrams)
}

/** Pure: the recipe's dish type (`tipo:` tag, else its public tags). */
export function dishTypeOf(r: WeekRecipe): string | null {
  const t = tagValue(r, 'tipo:')
  if (t) return t
  const tags = (r.tags ?? []).map(normalizeText)
  return [...HEAVY_DISH_TYPES, ...LIGHT_DISH_TYPES].find((d) => tags.some((x) => x === d || x === `${d}s`)) ?? null
}

/**
 * Pure: the main protein family and the ingredient term that makes it
 * (`proteina:` tag, else the ingredients, else the name). With quantities,
 * a family is the main only when its grams per serving reach its threshold
 * (legumbre 50 g seca / 120 g cocida, pescado 80 g comestibles, the rest
 * `proteinMinGrams`), and the one that reaches furthest wins: unas anchoas
 * en una ensalada or un puñado de garbanzos are a garnish (Cocina, COC-14).
 */
function mainProtein(r: WeekRecipe): { family: string; term: string | null } | null {
  const tag = tagValue(r, 'proteina:')
  const names = ingNames(r).filter((n) => !NOT_THE_THING.some((x) => n.includes(x)))
  const termIn = (family: string) => {
    const terms = PROTEIN_FAMILIES.find(([f]) => f === family)?.[1] ?? []
    for (const n of names) {
      if (family === 'legumbre' && !isLegumeName(n)) continue
      const t = terms.find((x) => hasWord(n, x))
      if (t) return t
    }
    return null
  }
  if (tag) {
    const family = PROTEIN_TAG_FAMILY[tag] ?? tag
    return { family, term: termIn(family) }
  }
  // With quantities for every protein line, the family that reaches furthest past its threshold.
  const reaches = PROTEIN_FAMILIES.map(([family, terms]) => ({ family, reach: familyReach(r, family, terms) }))
  if (reaches.every((x) => x.reach != null) && typeof r.servings === 'number' && r.servings > 0) {
    let best: { family: string; reach: number } | null = null
    for (const { family, reach } of reaches) if (reach! >= 1 && (!best || reach! > best.reach)) best = { family, reach: reach! }
    return best ? { family: best.family, term: termIn(best.family) } : null
  }
  for (const [family, terms] of PROTEIN_FAMILIES) {
    // Without quantities, cheese is the main only when the dish is named after it (not «queso rallado» on top).
    if (family === 'queso') continue
    if (names.some((n) => terms.some((t) => hasWord(n, t)) && (family !== 'legumbre' || isLegumeName(n)))) return { family, term: termIn(family) }
  }
  const name = normalizeText(r.name)
  for (const [family, terms] of PROTEIN_FAMILIES) {
    const t = terms.find((x) => hasWord(name, x))
    if (t) return { family, term: t }
  }
  return null
}

/** Pure: the main protein family (`proteina:` tag, else by grams per serving, else the first family in the ingredients, else in the name). */
export function mainProteinOf(r: WeekRecipe): string | null {
  return mainProtein(r)?.family ?? null
}

/**
 * Pure: legume as the main of the dish (Cocina, regla 1): the `tipo:`/
 * `proteina:` tag, or ≥ 50 g dry / ≥ 120 g cooked per serving. Without
 * quantities, a legume among the ingredients of a dish named after it.
 * Green beans, fresh peas or a handful of chickpeas on a salad don't count.
 */
export function isSpoonLegume(r: WeekRecipe): boolean {
  if (tagValue(r, 'tipo:') === 'legumbre' || tagValue(r, 'proteina:') === 'legumbre') return true
  if (!ingNames(r).some(isLegumeName)) return r.ingredients.length === 0 && LEGUME_TERMS.some((t) => hasWord(normalizeText(r.name), t))
  const reach = familyReach(r, 'legumbre', LEGUME_TERMS)
  if (reach != null) return reach >= 1
  return LEGUME_TERMS.some((t) => hasWord(normalizeText(r.name), t))
}

/**
 * Pure: fish or seafood is the main of the dish (Cocina, regla 2): the
 * `proteina:` tag, or ≥ 80 g edible per serving (the edible share of PRO-194
 * and PRO-281 already off). Without quantities, the dish's main protein.
 */
export function isFishDish(r: WeekRecipe): boolean {
  const tag = tagValue(r, 'proteina:')
  if (tag) return PROTEIN_TAG_FAMILY[tag] === 'pescado'
  if (!ingNames(r).some(isFishName)) return mainProteinOf(r) === 'pescado'
  const reach = familyReach(r, 'pescado', FISH_TERMS)
  if (reach != null) return reach >= 1
  return mainProteinOf(r) === 'pescado'
}

/** Pure: red meat or embutido as the main (Cocina, regla 9): the tag, ≥ 80 g per serving, or a red main protein. */
export function isRedMeatDish(r: WeekRecipe): boolean {
  const tag = tagValue(r, 'proteina:')
  if (tag) return RED_FAMILIES.includes(PROTEIN_TAG_FAMILY[tag] ?? tag)
  const g = sumGrams(r, (_, n) => isRedMeatName(n))
  if (g != null && r.ingredients.some((i) => isRedMeatName(normalizeText(i.ingredientName)))) return g >= WEEK_RULES_CONFIG.redMeatMinGrams
  return RED_FAMILIES.includes(mainProteinOf(r) ?? '')
}

/** Pure: fried or battered as the main (Cocina, regla 10): `tipo:frito`/`fritura` or the name (frito, rebozado, empanado, a la romana, croquetas…). */
export function isFriedDish(r: WeekRecipe): boolean {
  const type = dishTypeOf(r)
  if (type && FRIED_DISH_TYPES.includes(type)) return true
  return FRIED_NAME.test(normalizeText(r.name))
}

/** Pure: grams per serving of vegetables (Cocina, regla 8), or null when the recipe can't be measured. */
export function vegetableGramsPerServing(r: WeekRecipe): number | null {
  return sumGrams(r, (i) => isVegetable(i))
}

/** Pure: a cream, soup or purée of pulses (no meat or embutido) — light when ≤ `lightDinnerMaxKcal`. */
function isLightLegumeCream(r: WeekRecipe): boolean {
  const type = dishTypeOf(r)
  const name = normalizeText(r.name)
  const creamy = (type != null && ['crema', 'sopa', 'pure'].includes(type)) || /^(crema|pure|sopa)\b|\bhummus\b/.test(name)
  if (!creamy) return false
  const meat = ingNames(r).some((n) => isRedMeatName(n) || PROTEIN_FAMILIES.some(([f, terms]) => ['pollo', 'conejo'].includes(f) && terms.some((t) => hasWord(n, t)) && !NOT_THE_THING.some((x) => n.includes(x))))
  if (meat) return false
  const kcal = r.nutritionPerServing?.kcal
  return !(typeof kcal === 'number' && kcal > WEEK_RULES_CONFIG.lightDinnerMaxKcal)
}

/**
 * Pure: a light dinner. Heavy = a heavy dish type (guiso, arroz, pasta,
 * frito, asado, legumbre…), red meat or pulses as the main, or more than
 * `lightDinnerMaxKcal` per serving. Everything else is light (cremas,
 * verdura, pescado, huevo, ensaladas). A cream of pulses with no meat or
 * embutido and ≤ 600 kcal is light (Cocina, regla 6).
 */
export function isLightDish(r: WeekRecipe): boolean {
  const type = dishTypeOf(r)
  const protein = mainProteinOf(r)
  if ((type === 'legumbre' || protein === 'legumbre') && isLightLegumeCream(r)) return true
  if (type && HEAVY_DISH_TYPES.includes(type)) return false
  if (protein && ['ternera', 'cerdo', 'cordero', 'legumbre'].includes(protein)) return false
  const kcal = r.nutritionPerServing?.kcal
  if (typeof kcal === 'number' && kcal > WEEK_RULES_CONFIG.lightDinnerMaxKcal) return false
  const name = normalizeText(r.name)
  if (/\b(arroz|paella|pasta|espaguetis?|macarrones|lasana|guiso|estofado|cocido|potaje|fabada|frito|rebozad[oa]s?|empanad[oa]s?)\b/.test(name)) return false
  return true
}

/** Pure: did the household ask for light dinners? (memory notes, ficha facts, «Cuéntanos tu caso»). */
export function asksLightDinners(texts: readonly string[]): boolean {
  return texts.some((t) => /\bcenas? (?:mas |muy )?(?:ligeras?|suaves?|livianas?)\b|\bcenar (?:ligero|poco|suave)\b|\bpor la noche (?:algo )?ligero\b/.test(normalizeText(t)))
}

/** A staple, also when the name goes on («aceite de oliva virgen extra», «vino blanco», «caldo de pollo»). */
const isStaple = (n: string) => STAPLES.some((s) => n === s || n.startsWith(`${s} `) || hasWord(n, s) && n.split(' ').length <= s.split(' ').length + 1)
const dishKey = (name: string) => normalizeText(name).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Pure: «el mismo plato» by main ingredient + dish type (Cocina, regla 4):
 * «Lentejas estofadas» and «Lentejas guisadas» are both `legumbre` +
 * lenteja. Null when either is unknown (then only the recipe and the name count).
 */
export function sameDishKey(r: WeekRecipe): string | null {
  const type = dishTypeOf(r)
  const term = mainProtein(r)?.term
  return type && term ? `${term}|${type}` : null
}

// ─── The week ───────────────────────────────────────────────────

interface PlannedDish {
  dayIndex: number
  meal: string
  recipe: WeekRecipe
  /** `leftover` / `freezer`: eaten again on purpose, not a repeat. */
  reuse: boolean
}

const MAIN_MEALS: readonly string[] = ['lunch', 'dinner'] satisfies Meal[]

function plannedDishes(days: readonly DayMenu[], recipes: ReadonlyMap<string, WeekRecipe>): PlannedDish[] {
  const out: PlannedDish[] = []
  days.forEach((day, dayIndex) => {
    for (const meal of Object.keys(day ?? {})) {
      for (const dish of day[meal]?.dishes ?? []) {
        if (dish.kind !== 'recipe') continue
        const recipe = recipes.get(dish.recipeId)
        if (!recipe) continue
        out.push({ dayIndex, meal, recipe, reuse: dish.variant === 'leftover' || isTaperDish(dish) })
      }
    }
  })
  return out
}

const DAY = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const ref = (d: PlannedDish): WeekRuleSlotRef => ({ dayIndex: d.dayIndex, meal: d.meal, recipeId: d.recipe.id })
const result = (id: WeekRuleId, applies: boolean, score: number, detail: string, slots: WeekRuleSlotRef[] = []): WeekRuleResult => ({
  id, applies, ok: !applies || score >= 1, score: applies ? Math.max(0, Math.min(1, score)) : 1, detail, slots, soft: SOFT_WEEK_RULES.has(id),
})
/** «Como mucho N»: 1 up to the cap, then down by 1/N per extra one. */
const capScore = (n: number, max: number) => (n <= max ? 1 : Math.max(0, 1 - (n - max) / max))

/** Days with time for long recipes (Cocina, regla 11; PRO-138 time per weekday). */
function dayHasTime(dayIndex: number, budgets: ScoreWeekOptions['timeBudgetByDay']): boolean {
  const cfg = WEEK_RULES_CONFIG
  const known = budgets && Object.values(budgets).some((b) => b != null)
  if (!known) return cfg.defaultDaysWithTime.includes(dayIndex % 7)
  const b = budgets![dayIndex] ?? null
  if (!b || b.minutes <= 0) return true
  // «Poco rato de trabajo»: a long stew that cooks by itself fits; a total limit has to be over an hour.
  return b.mode === 'activo' || b.minutes > cfg.longRecipeMinutes
}

/** Pure: score a week with every rule. */
export function scoreWeek(days: readonly DayMenu[], recipes: ReadonlyMap<string, WeekRecipe>, opts: ScoreWeekOptions): WeekScore {
  const cfg = WEEK_RULES_CONFIG
  const all = plannedDishes(days, recipes)
  const mains = all.filter((d) => MAIN_MEALS.includes(d.meal))
  const fresh = mains.filter((d) => !d.reuse)
  const mainSlots = new Set(mains.map((d) => `${d.dayIndex}|${d.meal}`)).size
  const enough = mainSlots >= cfg.minSlotsForCounts
  const rules: WeekRuleResult[] = []

  // 1. Legumbre de cuchara (sobras incluidas: se come otra vez).
  const legumes = mains.filter((d) => isSpoonLegume(d.recipe))
  const legumeDays = new Set(legumes.map((d) => `${d.dayIndex}|${d.meal}`)).size
  rules.push(result('legumbre', enough && opts.legumesAllowed !== false, legumeDays / cfg.minLegumes, `${legumeDays} de ${cfg.minLegumes}`))

  // 2. Pescado 2–3.
  const fish = new Set(mains.filter((d) => isFishDish(d.recipe)).map((d) => `${d.dayIndex}|${d.meal}`)).size
  const fishScore = fish < cfg.minFish ? fish / cfg.minFish : fish > cfg.maxFish ? Math.max(0, 1 - (fish - cfg.maxFish) / cfg.maxFish) : 1
  rules.push(result('pescado', enough && opts.fishAllowed !== false, fishScore, `${fish} (entre ${cfg.minFish} y ${cfg.maxFish})`))

  // 3. Misma proteína principal a mediodía y en la cena.
  const sameDay: PlannedDish[] = []
  const sameDayText: string[] = []
  let daysWithBoth = 0
  for (let d = 0; d < days.length; d++) {
    const lunch = mains.filter((x) => x.dayIndex === d && x.meal === 'lunch')
    const dinner = mains.filter((x) => x.dayIndex === d && x.meal === 'dinner')
    if (!lunch.length || !dinner.length) continue
    daysWithBoth++
    const lp = new Set(lunch.map((x) => mainProteinOf(x.recipe)).filter((p): p is string => !!p && p !== 'ninguna'))
    const clash = dinner.filter((x) => { const p = mainProteinOf(x.recipe); return !!p && lp.has(p) })
    if (clash.length) {
      sameDay.push(...lunch.filter((x) => clash.some((c) => mainProteinOf(c.recipe) === mainProteinOf(x.recipe))), ...clash)
      sameDayText.push(`${DAY[d] ?? d}: ${mainProteinOf(clash[0].recipe)}`)
    }
  }
  rules.push(result('proteina_mismo_dia', daysWithBoth > 0, 1 - sameDayText.length / Math.max(1, daysWithBoth), sameDayText.join('; ') || 'ninguno', sameDay.map(ref)))

  // 4. Platos repetidos (PRO-238): misma receta, mismo nombre o mismo ingrediente
  // principal + tipo de plato (PRO-280), salvo sobras o táper.
  const seen = new Map<string, PlannedDish>()
  const repeats: PlannedDish[] = []
  /** Recipe id → the first dish that is «the same plate» (for rule 5: a repeat is not a second dish). */
  const plateOf = new Map<string, string>()
  for (const d of all.filter((x) => !x.reuse)) {
    const same = sameDishKey(d.recipe)
    const keys = [`id:${d.recipe.id}`, `n:${dishKey(d.recipe.name)}`, ...(same ? [`m:${same}`] : [])]
    const first = keys.map((k) => seen.get(k)).find((x) => !!x)
    if (first) repeats.push(d)
    plateOf.set(d.recipe.id, plateOf.get(first?.recipe.id ?? '') ?? first?.recipe.id ?? d.recipe.id)
    for (const k of keys) if (!seen.has(k)) seen.set(k, d)
  }
  rules.push(result('plato_repetido', all.length > 0, repeats.length ? 0 : 1, repeats.map((d) => `${d.recipe.name} (${DAY[d.dayIndex]})`).join('; ') || 'ninguno', repeats.map(ref)))

  // 5. Aprovechar un ingrediente fresco en dos platos distintos.
  const byIngredient = new Map<string, Set<string>>()
  for (const d of fresh) {
    for (const n of new Set(ingNames(d.recipe))) {
      if (!n || isStaple(n)) continue
      const set = byIngredient.get(n) ?? new Set<string>()
      set.add(plateOf.get(d.recipe.id) ?? d.recipe.id)
      byIngredient.set(n, set)
    }
  }
  const shared = [...byIngredient].filter(([, ids]) => ids.size >= 2).map(([n]) => n)
  rules.push(result('aprovechar', new Set(fresh.map((d) => plateOf.get(d.recipe.id) ?? d.recipe.id)).size >= 2, shared.length / cfg.sharedIngredientsTarget, shared.slice(0, 5).join(', ') || 'ninguno'))

  // 6. Cenas ligeras, si el hogar lo pidió.
  const dinners = mains.filter((d) => d.meal === 'dinner')
  const heavy = dinners.filter((d) => !isLightDish(d.recipe))
  rules.push(result('cenas_ligeras', !!opts.lightDinners && dinners.length > 0, dinners.length ? 1 - heavy.length / dinners.length : 1, heavy.map((d) => `${d.recipe.name} (${DAY[d.dayIndex]})`).join('; ') || 'todas ligeras', heavy.map(ref)))

  // 7. Temporada.
  const outOfSeason = all.filter((d) => {
    const fit = d.recipe.seasonFit
    if (fit && Object.keys(fit).length) return !fit[opts.season]
    return !isInSeason((d.recipe.seasons ?? []) as Season[], opts.season)
  })
  rules.push(result('temporada', all.length > 0, all.length ? 1 - outOfSeason.length / all.length : 1, outOfSeason.map((d) => d.recipe.name).join('; ') || 'todo de temporada', outOfSeason.map(ref)))

  // 8. Verdura todos los días (blanda): ≥ 100 g por ración en la comida o la cena de cada día.
  const mainDays = [...new Set(mains.map((d) => d.dayIndex))].sort((a, b) => a - b)
  const vegUnknown = mains.some((d) => vegetableGramsPerServing(d.recipe) == null)
  const noVegDays = mainDays.filter((day) => !mains.some((d) => d.dayIndex === day && (vegetableGramsPerServing(d.recipe) ?? 0) >= cfg.vegetableMinGrams))
  rules.push(result('verdura_diaria', mainDays.length > 0 && !vegUnknown, 1 - noVegDays.length / Math.max(1, mainDays.length),
    noVegDays.map((day) => DAY[day] ?? String(day)).join(', ') || 'todos los días',
    mains.filter((d) => noVegDays.includes(d.dayIndex)).map(ref)))

  // 9. Carne roja y embutido como plato fuerte, como mucho 2 (blanda; las sobras no se cocinan otra vez).
  const red = fresh.filter((d) => isRedMeatDish(d.recipe))
  rules.push(result('carne_roja', fresh.length > 0, capScore(red.length, cfg.maxRedMeat), `${red.length} (como mucho ${cfg.maxRedMeat})`, red.length > cfg.maxRedMeat ? red.map(ref) : []))

  // 10. Fritos y rebozados, como mucho 2 (blanda).
  const fried = fresh.filter((d) => isFriedDish(d.recipe))
  rules.push(result('fritos', fresh.length > 0, capScore(fried.length, cfg.maxFried), `${fried.length} (como mucho ${cfg.maxFried})`, fried.length > cfg.maxFried ? fried.map(ref) : []))

  // 11. Lo de más de 60 minutos, solo los días con tiempo (blanda).
  const long = fresh.filter((d) => (recipeTotalMinutes(d.recipe) ?? 0) > cfg.longRecipeMinutes)
  const rushed = long.filter((d) => !dayHasTime(d.dayIndex, opts.timeBudgetByDay))
  rules.push(result('largo_con_tiempo', long.length > 0, 1 - rushed.length / Math.max(1, long.length),
    rushed.map((d) => `${d.recipe.name} (${DAY[d.dayIndex]})`).join('; ') || 'todo en su día', rushed.map(ref)))

  const applying = rules.filter((r) => r.applies)
  const weight = (r: WeekRuleResult) => (r.soft ? cfg.softRuleWeight : 1)
  const totalWeight = applying.reduce((s, r) => s + weight(r), 0)
  return {
    score: totalWeight > 0 ? applying.reduce((s, r) => s + r.score * weight(r), 0) / totalWeight : 1,
    ok: applying.every((r) => r.ok || r.soft),
    rules,
  }
}
