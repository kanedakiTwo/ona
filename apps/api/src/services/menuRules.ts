/**
 * What the household said about its menu, as rules the menu keeps
 * (2026-11-19, 3 weeks of conversations): «me gustaría prescindir del
 * arroz», «que no me sugieras recetas de legumbres», «arroz no más de un día
 * a la semana», «lentejas dos veces como mucho», «cenas ligeras». Mimo saved
 * many of them as a free note the generator never read, so the next menu
 * brought «Cebollas rellenas de arroz», chili sin carne and hummus, and
 * «patatas guisadas» for dinner.
 *
 * Pure. Sources (`profile/reader.ts`): the ficha's `menu_rule` facts (what
 * Mimo saves now) and, for what was saved as text before, the household's
 * notes and principles read with fixed patterns (`rulesFromNotes`): only a
 * food or a food category the patterns know, never anything else.
 *
 * Also the sense checks of «Cambiar» without a dish (`menuSlotPick.ts`): no
 * sweet dish as lunch or dinner, light dishes, the main food of a dish (not
 * the same twice in the week).
 *
 * Spec: specs/menus.md («Lo que el hogar ha dicho del menú»).
 */
import { FOOD_CATEGORY_WORDS, LEGUME_TERMS, OFFAL_TERMS, foodGroupFor, nameHasTerm, normalizeText, recipeHasFood, type FoodGroup } from './dietaryRestrictions.js'

export interface WeeklyLimit {
  /** A food or a category, as said («arroz», «lentejas», «legumbres»). */
  target: string
  /** At most this many dishes with it a week. */
  times: number
}

export type LightMeal = 'lunch' | 'dinner'

export interface NoteRules {
  /** Foods or categories the household doesn't want: they join the dislikes. */
  avoid: string[]
  weeklyLimits: WeeklyLimit[]
  lightMeals: LightMeal[]
}

// ─── Reading notes (fixed patterns) ─────────────────────────────

/** Foods a note may name: every category word, every legume and offal, and a few common ones. */
const NOTE_FOODS: string[] = [...new Set([
  ...FOOD_CATEGORY_WORDS,
  ...LEGUME_TERMS.filter((t) => t.length > 3),
  ...OFFAL_TERMS,
  'pasta', 'pizza', 'pollo', 'pavo', 'huevo', 'ternera', 'cordero', 'conejo', 'chorizo', 'embutido', 'setas',
  'champinon', 'quinoa', 'cuscus', 'salmon', 'atun', 'bacalao', 'merluza', 'sardina', 'calabaza', 'berenjena',
  'coliflor', 'brocoli', 'espinacas', 'acelgas', 'pimiento', 'cebolla', 'ajo', 'picante', 'queso', 'nata',
  'carne roja', 'carnes rojas',
])].sort((a, b) => b.length - a.length)

const NUMBER_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }
const NUMBER = '(\\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis)'
const TIMES_RE = new RegExp(`\\b${NUMBER}\\s+(?:vez|veces|dia|dias|platos?|comidas?|cenas?)\\b`)
const CAP_RE = /\b(como mucho|como maximo|maximo|max|no mas de|nada mas que|solo|solamente|a lo sumo|como tope|tope de|limite de|no mas que)\b/
const CAP_NUMBER_RE = new RegExp(`\\b(?:como mucho|como maximo|maximo|no mas de|a lo sumo|solo)\\s+${NUMBER}\\b`)
const AVOID_RE = /\b(sin|ni|nada de|prescindir|prescindimos|prescinde|evitar|evita|evitamos|evitad|quitar|quita|quitad|fuera|odio|odiamos|no soporto|no soportamos|no (?:me |nos |le |les |te )?(?:gusta|gustan|sugieras|sugierais|sugerir|pongas|pongais|poner|propongas|metas|incluyas|quiero|queremos|quiere|comemos|como|come|tomamos|tomo|toma|apetece|apetecen|sienta|sientan|pueden|puede))\b/
const LIGHT_RE = /\b(cenas?|cenar|ceno|cenamos|comidas?|almuerzos?)\b[^.]{0,25}?\b(ligera|ligeras|ligero|ligeros|suaves?|light)\b|\b(ligero|ligera|ligeras|ligeros|suaves?|light)\b[^.]{0,20}?\b(para )?(cenar|cena|cenas|comer|comida|comidas)\b/
/** «No me gusta que repitas el pollo» talks about repeating, not about the food. */
const NOT_AVOID_RE = /\bno (?:me |nos |le |les )?gustan? que\b|\brepit|\brepet/
/** «No hace falta que las cenas sean ligeras» is not the rule. */
const NOT_LIGHT_RE = /\bno (hace falta|necesit|importa)|\bda igual\b/

function termRe(term: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(e?s)?(?=$|[^a-z0-9])`, 'g')
}

/** The foods a clause names, longest first («carne roja» before «carne»). */
export function foodsIn(clause: string): string[] {
  let rest = ` ${normalizeText(clause)} `
  const out: string[] = []
  for (const food of NOTE_FOODS) {
    if (!nameHasTerm(rest, food)) continue
    out.push(food)
    rest = rest.replace(termRe(food), ' ')
  }
  return out
}

function numberOf(word: string): number {
  return NUMBER_WORDS[word] ?? Number(word)
}

function addLimit(out: WeeklyLimit[], target: string, times: number) {
  if (!Number.isFinite(times) || times < 1 || times > 13) return
  const same = out.find((l) => l.target === target)
  if (same) same.times = Math.min(same.times, times)
  else out.push({ target, times })
}

/**
 * Pure: the menu rules in free text (notes, principles, an affinity's
 * target). Only foods and categories it knows; a clause with a cap and a
 * number is a weekly limit, one with «sin», «no me sugieras», «prescindir
 * de»… is an avoid; «cenas ligeras» is a light dinner.
 */
export function rulesFromNotes(texts: readonly string[]): NoteRules {
  const out: NoteRules = { avoid: [], weeklyLimits: [], lightMeals: [] }
  for (const text of texts) {
    if (typeof text !== 'string' || !text.trim()) continue
    for (const sentence of normalizeText(text).split(/[.;!?\n]+/)) {
      if (LIGHT_RE.test(sentence) && !NOT_LIGHT_RE.test(sentence)) {
        const m = sentence.match(LIGHT_RE)!
        const meal: LightMeal = /\b(comidas?|comer|almuerzos?)\b/.test(m[0]) && !/\bcen/.test(m[0]) ? 'lunch' : 'dinner'
        if (!out.lightMeals.includes(meal)) out.lightMeals.push(meal)
      }
      for (const clause of sentence.split(/,|\bpero\b/)) {
        const foods = foodsIn(clause)
        if (foods.length === 0) continue
        const times = clause.match(TIMES_RE)?.[1] ?? clause.match(CAP_NUMBER_RE)?.[1]
        if (times && CAP_RE.test(clause)) {
          for (const f of foods) addLimit(out.weeklyLimits, f, numberOf(times))
          continue
        }
        if (AVOID_RE.test(clause) && !NOT_AVOID_RE.test(clause)) for (const f of foods) if (!out.avoid.includes(f)) out.avoid.push(f)
      }
    }
  }
  return out
}

/** Two sets of limits as one: the same food keeps the lowest. */
export function mergeLimits(a: readonly WeeklyLimit[], b: readonly WeeklyLimit[]): WeeklyLimit[] {
  const out: WeeklyLimit[] = a.map((l) => ({ ...l }))
  for (const l of b) addLimit(out, l.target.trim().toLowerCase(), l.times)
  return out
}

// ─── Weekly limits on recipes ───────────────────────────────────

type FoodRecipe = Parameters<typeof recipeHasFood>[0]

const groupCache = new Map<string, FoodGroup | null>()
const hasCache = new Map<string, WeakMap<object, boolean>>()

/** True when the recipe counts for the limit (its name or an ingredient has the food). Cached per recipe. */
export function countsFor(recipe: FoodRecipe, target: string): boolean {
  if (!groupCache.has(target)) groupCache.set(target, foodGroupFor(target))
  const g = groupCache.get(target)
  if (!g) return false
  let seen = hasCache.get(target)
  if (!seen) hasCache.set(target, (seen = new WeakMap()))
  let v = seen.get(recipe)
  if (v === undefined) seen.set(recipe, (v = recipeHasFood(recipe, g)))
  return v
}

/** Pure: how many dishes of each limit the recipes already have. */
export function limitCounts(limits: readonly WeeklyLimit[], recipes: readonly FoodRecipe[]): number[] {
  return limits.map((l) => recipes.filter((r) => countsFor(r, l.target)).length)
}

/** Pure: the pool without the recipes of a limit already reached (`counts` from `limitCounts`). */
export function withinLimits<T extends FoodRecipe>(pool: T[], limits: readonly WeeklyLimit[], counts: readonly number[]): T[] {
  const full = limits.filter((l, i) => counts[i] >= l.times)
  if (full.length === 0) return pool
  return pool.filter((r) => !full.some((l) => countsFor(r, l.target)))
}

// ─── Sense checks ───────────────────────────────────────────────

interface SenseRecipe {
  name: string
  course?: string | null
  tags?: readonly string[] | null
  dishTypes?: readonly string[] | null
  nutritionPerServing?: { kcal?: number | null } | null
  ingredients: ReadonlyArray<{ ingredientName: string }>
}

const SWEET_NAMES = [
  'tarta', 'bizcocho', 'flan', 'natillas', 'helado', 'galleta', 'brownie', 'magdalena', 'muffin', 'cupcake', 'donut',
  'rosquilla', 'torrija', 'churro', 'mousse', 'tiramisu', 'coulant', 'cheesecake', 'compota', 'mermelada', 'pudin',
  'pudding', 'crema catalana', 'arroz con leche', 'leche frita', 'baklava', 'kunafa', 'knafeh', 'gofre', 'sorbete',
  'granizado', 'batido', 'smoothie', 'bombon', 'trufa de chocolate', 'turron', 'polvoron', 'mazapan', 'macedonia',
  'buñuelos de viento', 'bunuelos de viento', 'crepes dulces', 'crema pastelera', 'profiterol', 'carrot cake',
  'banana bread', 'pan de platano', 'galletas', 'cookies', 'panna cotta', 'yogur helado', 'postre',
]
const SWEETENERS = [
  'azucar', 'miel', 'chocolate', 'cacao', 'sirope', 'leche condensada', 'dulce de leche', 'nutella', 'crema de cacao',
  'panela', 'melaza', 'caramelo', 'azucar glas', 'azucar moreno', 'edulcorante', 'stevia', 'confitura',
]
/** Anything that makes a dish savoury: a sweetener alone doesn't make «salmón con miel» a dessert. */
const SAVOURY = [
  'cebolla', 'cebolleta', 'ajo', 'puerro', 'chalota', 'pimiento', 'tomate', 'pimienta', 'comino', 'pimenton', 'caldo',
  'carne', 'pollo', 'pavo', 'ternera', 'cerdo', 'cordero', 'jamon', 'chorizo', 'bacon', 'panceta', 'pescado', 'atun',
  'salmon', 'bacalao', 'merluza', 'gamba', 'langostino', 'lechuga', 'rucula', 'canonigos', 'escarola', 'vinagre',
  'mostaza', 'salsa de soja', 'curry', 'perejil', 'cilantro', 'oregano', 'lenteja', 'garbanzo', 'alubia', 'calabacin',
  'berenjena', 'espinaca', 'champinon', 'seta', 'patata', 'anchoa', 'aceituna', 'alcaparra',
]

const sweetCache = new WeakMap<object, boolean>()

/** Pure: a dessert or a sweet (course, tag, name, or sweet ingredients with nothing savoury). Cached. */
export function isSweetDish(recipe: SenseRecipe): boolean {
  const hit = sweetCache.get(recipe)
  if (hit !== undefined) return hit
  const tags = (recipe.tags ?? []).map(normalizeText)
  const name = normalizeText(recipe.name)
  const ings = recipe.ingredients.map((i) => normalizeText(i.ingredientName))
  const v =
    recipe.course === 'dessert' ||
    tags.some((t) => t === 'postre' || t === 'dulce' || t === 'postres') ||
    (SWEET_NAMES.some((t) => nameHasTerm(name, t)) && !SAVOURY.some((t) => nameHasTerm(name, t))) ||
    (ings.some((n) => SWEETENERS.some((t) => nameHasTerm(n, t))) && !ings.some((n) => SAVOURY.some((t) => nameHasTerm(n, t))) && !SAVOURY.some((t) => nameHasTerm(name, t)))
  sweetCache.set(recipe, v)
  return v
}

/** Light dinner: kcal per serving at most this (when known). */
export const LIGHT_MAX_KCAL = 600
const HEAVY_NAMES = [
  'frito', 'frita', 'fritos', 'fritas', 'rebozado', 'rebozada', 'empanado', 'empanada', 'croqueta', 'guisado', 'guisada',
  'guiso', 'estofado', 'estofada', 'cocido', 'fabada', 'potaje', 'callos', 'lasana', 'canelones', 'carbonara',
  'hamburguesa', 'pizza', 'a la importancia', 'a la riojana', 'migas', 'tartiflette', 'raclette', 'fondue',
  'cachopo', 'flamenquin', 'san jacobo', 'chili', 'feijoada',
  'olla podrida', 'escudella', 'puchero', 'cassoulet', 'moussaka', 'musaka',
]
const HEAVY_INGREDIENTS = [
  'chorizo', 'morcilla', 'tocino', 'panceta', 'bacon', 'beicon', 'sobrasada', 'butifarra', 'chistorra', 'longaniza',
  'torrezno', 'oreja', 'callos', 'morro', 'manitas', 'careta', 'codillo', 'bechamel', 'besamel', 'nata para cocinar',
  'nata liquida', 'manteca', 'hojaldre', 'masa quebrada', 'chicharron',
]
const lightCache = new WeakMap<object, boolean>()

/** Pure: a light dish (no stew, legume dish, fry, cured pork or offal; ≤ 600 kcal when known). Cached. */
export function isLightDish(recipe: SenseRecipe): boolean {
  const hit = lightCache.get(recipe)
  if (hit !== undefined) return hit
  const name = normalizeText(recipe.name)
  const kcal = recipe.nutritionPerServing?.kcal
  const heavy =
    (typeof kcal === 'number' && kcal > LIGHT_MAX_KCAL) ||
    (recipe.dishTypes ?? []).some((t) => t === 'legumbres' || t === 'guisos' || t === 'pizza') ||
    HEAVY_NAMES.some((t) => nameHasTerm(name, t)) ||
    recipe.ingredients.some((i) => HEAVY_INGREDIENTS.some((t) => nameHasTerm(normalizeText(i.ingredientName), t)))
  lightCache.set(recipe, !heavy)
  return !heavy
}

/**
 * The main food of a dish, for «not the same twice in the week» (two dishes
 * of higadillos the same week, 2026-11). Offal first, then meats, fish and
 * seafood, legumes, eggs and tofu; the first ingredient that is one wins.
 */
const MAIN_FOODS: Array<[string, string[]]> = [
  ['higado', ['higado', 'higadillo', 'higaditos', 'foie']],
  ['rinon', ['rinon']], ['callos', ['callos']], ['molleja', ['molleja']], ['oreja', ['oreja']], ['codorniz', ['codorniz']],
  ['pollo', ['pollo', 'pechuga', 'muslo', 'contramuslo', 'alitas']], ['pavo', ['pavo']],
  ['ternera', ['ternera', 'vaca', 'buey', 'vacuno', 'entrecot', 'chuleton', 'morcillo', 'rabo de toro']],
  ['cerdo', ['cerdo', 'lomo de cerdo', 'secreto', 'presa', 'pluma', 'costilla', 'carrillera', 'solomillo de cerdo']],
  ['cordero', ['cordero', 'cabrito']], ['conejo', ['conejo']], ['pato', ['pato', 'magret']],
  ['carne picada', ['carne picada', 'albondiga', 'hamburguesa']],
  ['merluza', ['merluza', 'pescadilla']], ['salmon', ['salmon']], ['bacalao', ['bacalao']], ['atun', ['atun', 'bonito']],
  ['sardina', ['sardina', 'boqueron', 'anchoa']], ['dorada', ['dorada', 'lubina']], ['caballa', ['caballa']],
  ['gamba', ['gamba', 'langostino']], ['calamar', ['calamar', 'sepia', 'chipiron', 'pota']], ['pulpo', ['pulpo']],
  ['mejillon', ['mejillon', 'almeja', 'berberecho']],
  ['lenteja', ['lenteja']], ['garbanzo', ['garbanzo', 'hummus']], ['alubia', ['alubia', 'judion', 'frijol', 'faba', 'pocha']],
  ['tofu', ['tofu', 'tempeh']], ['huevo', ['huevo']],
]

const keyCache = new WeakMap<object, string | null>()

/** Pure: the main food of a recipe («higado», «pollo», «lenteja»…), or null for a dish without one. Cached. */
export function mainFoodKey(recipe: Pick<SenseRecipe, 'name' | 'ingredients'>): string | null {
  const hit = keyCache.get(recipe)
  if (hit !== undefined) return hit
  let key: string | null = null
  const names = [...recipe.ingredients.map((i) => normalizeText(i.ingredientName)), normalizeText(recipe.name)]
  outer: for (const n of names) {
    for (const [k, terms] of MAIN_FOODS) if (terms.some((t) => nameHasTerm(n, t))) { key = k; break outer }
  }
  keyCache.set(recipe, key)
  return key
}

