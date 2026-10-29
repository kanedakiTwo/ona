/**
 * Calendario de producto (PRO-375, specs/recipes.md → «Este mes»): fruits
 * and vegetables of Spain, the months they are in season (1 = January) and
 * an emoji each. `ingredients.seasons` is not good enough for this (35 seed
 * rows, by season), so the catalogue's «Este mes» row reads this list.
 *
 * `terms` are normalised (lower case, no accents), singular: an ingredient
 * counts as the product when its name has one of them as a whole word
 * (plurals too), and none of `exclude`. «Setas» also takes champiñón,
 * boletus…; «Calabaza» never takes «calabacín».
 */

export interface SeasonalProduce {
  name: string
  emoji: string
  /** Months in season, 1–12. */
  months: readonly number[]
  terms: readonly string[]
  /** Words that make a match not count (e.g. «vinagre de manzana»). */
  exclude?: readonly string[]
}

/** One product of the month with how many published catalogue recipes use it (`GET /recipes/seasonal-produce`). */
export interface SeasonalProduceCount {
  name: string
  emoji: string
  recipeCount: number
}

/** A product of the month shows in the row only if this many published recipes use it. */
export const SEASONAL_PRODUCE_MIN_RECIPES = 3

const AUTUMN_WINTER = [10, 11, 12, 1, 2, 3] as const

export const SEASONAL_PRODUCE: readonly SeasonalProduce[] = [
  // ── Verduras y hortalizas ──
  { name: 'Acelgas', emoji: '🥬', months: [10, 11, 12, 1, 2, 3, 4, 5], terms: ['acelga'] },
  { name: 'Ajo', emoji: '🧄', months: [5, 6, 7], terms: ['ajo'], exclude: ['polvo'] },
  { name: 'Alcachofa', emoji: '🌿', months: [11, 12, 1, 2, 3, 4, 5], terms: ['alcachofa'] },
  { name: 'Apio', emoji: '🥬', months: [10, 11, 12, 1, 2, 3, 4], terms: ['apio'], exclude: ['sal'] },
  { name: 'Berenjena', emoji: '🍆', months: [6, 7, 8, 9, 10], terms: ['berenjena'] },
  { name: 'Boniato', emoji: '🍠', months: [10, 11, 12, 1, 2], terms: ['boniato', 'batata'] },
  { name: 'Borraja', emoji: '🌿', months: [11, 12, 1, 2, 3], terms: ['borraja'] },
  { name: 'Brócoli', emoji: '🥦', months: AUTUMN_WINTER, terms: ['brocoli', 'brecol'] },
  { name: 'Calabacín', emoji: '🥒', months: [5, 6, 7, 8, 9], terms: ['calabacin'] },
  { name: 'Calabaza', emoji: '🎃', months: [9, 10, 11, 12, 1], terms: ['calabaza'] },
  { name: 'Calçots', emoji: '🌱', months: [12, 1, 2, 3], terms: ['calcot'] },
  { name: 'Cardo', emoji: '🌿', months: [11, 12, 1, 2], terms: ['cardo'] },
  { name: 'Cebolla', emoji: '🧅', months: [5, 6, 7, 8, 9], terms: ['cebolla'], exclude: ['polvo', 'frita'] },
  { name: 'Chirivía', emoji: '🥕', months: [10, 11, 12, 1, 2], terms: ['chirivia'] },
  { name: 'Col', emoji: '🥬', months: AUTUMN_WINTER, terms: ['col', 'repollo', 'berza'], exclude: ['bruselas', 'lombarda'] },
  { name: 'Coles de Bruselas', emoji: '🥬', months: [10, 11, 12, 1, 2], terms: ['col de bruselas', 'coles de bruselas'] },
  { name: 'Coliflor', emoji: '🥦', months: AUTUMN_WINTER, terms: ['coliflor'] },
  { name: 'Endibia', emoji: '🥬', months: [11, 12, 1, 2, 3], terms: ['endibia', 'endivia'] },
  { name: 'Escarola', emoji: '🥬', months: [10, 11, 12, 1, 2], terms: ['escarola'] },
  { name: 'Espárragos', emoji: '🌱', months: [3, 4, 5, 6], terms: ['esparrago'] },
  { name: 'Espinacas', emoji: '🥬', months: [10, 11, 12, 1, 2, 3, 4], terms: ['espinaca'] },
  { name: 'Grelos', emoji: '🥬', months: [11, 12, 1, 2, 3], terms: ['grelo'] },
  { name: 'Guisantes', emoji: '🫛', months: [2, 3, 4, 5], terms: ['guisante'] },
  { name: 'Habas', emoji: '🫛', months: [2, 3, 4, 5], terms: ['haba'] },
  { name: 'Hinojo', emoji: '🌿', months: AUTUMN_WINTER, terms: ['hinojo'], exclude: ['semilla'] },
  { name: 'Judías verdes', emoji: '🫛', months: [6, 7, 8, 9], terms: ['judia verde', 'judias verde', 'vaina', 'bajoqueta'] },
  { name: 'Lechuga', emoji: '🥬', months: [4, 5, 6, 7, 8, 9, 10], terms: ['lechuga'] },
  { name: 'Lombarda', emoji: '🥬', months: [10, 11, 12, 1, 2], terms: ['lombarda', 'col lombarda'] },
  { name: 'Maíz', emoji: '🌽', months: [7, 8, 9], terms: ['maiz', 'mazorca'], exclude: ['harina', 'almidon', 'tortilla', 'palomita'] },
  { name: 'Nabo', emoji: '🥔', months: AUTUMN_WINTER, terms: ['nabo'] },
  { name: 'Patata', emoji: '🥔', months: [5, 6, 7, 8, 9, 10], terms: ['patata'], exclude: ['chip', 'copo'] },
  { name: 'Pepino', emoji: '🥒', months: [5, 6, 7, 8, 9], terms: ['pepino'] },
  { name: 'Pimiento', emoji: '🫑', months: [7, 8, 9, 10], terms: ['pimiento'] },
  { name: 'Puerro', emoji: '🌱', months: [9, 10, 11, 12, 1, 2, 3, 4], terms: ['puerro'] },
  { name: 'Rábano', emoji: '🌱', months: [2, 3, 4, 5, 10, 11], terms: ['rabano', 'rabanito'] },
  { name: 'Remolacha', emoji: '🫜', months: [9, 10, 11, 12, 1, 2], terms: ['remolacha'] },
  { name: 'Setas', emoji: '🍄', months: [9, 10, 11, 12], terms: ['seta', 'champinon', 'boletus', 'niscalo', 'rebozuelo', 'shiitake', 'portobello'] },
  { name: 'Tomate', emoji: '🍅', months: [6, 7, 8, 9, 10], terms: ['tomate'], exclude: ['concentrado', 'frito', 'ketchup', 'seco'] },
  { name: 'Zanahoria', emoji: '🥕', months: [10, 11, 12, 1, 2, 3, 4, 5], terms: ['zanahoria'] },
  // ── Frutas ──
  { name: 'Aguacate', emoji: '🥑', months: [11, 12, 1, 2, 3, 4], terms: ['aguacate'] },
  { name: 'Albaricoque', emoji: '🍑', months: [5, 6, 7], terms: ['albaricoque'], exclude: ['orejon'] },
  { name: 'Arándanos', emoji: '🫐', months: [6, 7, 8], terms: ['arandano'] },
  { name: 'Caqui', emoji: '🟠', months: [10, 11, 12], terms: ['caqui', 'kaki'] },
  { name: 'Castañas', emoji: '🌰', months: [10, 11, 12], terms: ['castana'], exclude: ['harina'] },
  { name: 'Cerezas', emoji: '🍒', months: [5, 6, 7], terms: ['cereza', 'picota'] },
  { name: 'Chirimoya', emoji: '🍈', months: [10, 11, 12, 1, 2], terms: ['chirimoya'] },
  { name: 'Ciruelas', emoji: '🟣', months: [6, 7, 8, 9], terms: ['ciruela'], exclude: ['pasa', 'seca'] },
  { name: 'Frambuesas', emoji: '🫐', months: [6, 7, 8, 9], terms: ['frambuesa'] },
  { name: 'Fresas', emoji: '🍓', months: [2, 3, 4, 5, 6], terms: ['fresa', 'freson'] },
  { name: 'Granada', emoji: '🔴', months: [9, 10, 11, 12], terms: ['granada'] },
  { name: 'Higos', emoji: '🟤', months: [8, 9, 10], terms: ['higo', 'breva'], exclude: ['seco'] },
  { name: 'Kiwi', emoji: '🥝', months: [11, 12, 1, 2, 3, 4], terms: ['kiwi'] },
  { name: 'Limón', emoji: '🍋', months: [11, 12, 1, 2, 3, 4, 5], terms: ['limon'] },
  { name: 'Mandarina', emoji: '🍊', months: [10, 11, 12, 1, 2], terms: ['mandarina', 'clementina'] },
  { name: 'Mango', emoji: '🥭', months: [8, 9, 10, 11], terms: ['mango'] },
  { name: 'Manzana', emoji: '🍎', months: [8, 9, 10, 11, 12, 1, 2], terms: ['manzana'], exclude: ['vinagre', 'sidra'] },
  { name: 'Melocotón', emoji: '🍑', months: [6, 7, 8, 9], terms: ['melocoton'], exclude: ['almibar'] },
  { name: 'Melón', emoji: '🍈', months: [6, 7, 8, 9], terms: ['melon'] },
  { name: 'Membrillo', emoji: '🍐', months: [9, 10, 11], terms: ['membrillo'], exclude: ['dulce', 'carne'] },
  { name: 'Naranja', emoji: '🍊', months: [11, 12, 1, 2, 3, 4, 5], terms: ['naranja'] },
  { name: 'Nectarina', emoji: '🍑', months: [6, 7, 8], terms: ['nectarina'] },
  { name: 'Níspero', emoji: '🟠', months: [4, 5, 6], terms: ['nispero'] },
  { name: 'Pera', emoji: '🍐', months: [7, 8, 9, 10, 11, 12], terms: ['pera'] },
  { name: 'Pomelo', emoji: '🍊', months: [11, 12, 1, 2, 3], terms: ['pomelo'] },
  { name: 'Sandía', emoji: '🍉', months: [6, 7, 8, 9], terms: ['sandia'] },
  { name: 'Uvas', emoji: '🍇', months: [8, 9, 10, 11], terms: ['uva'], exclude: ['pasa'] },
]

/** Lower case, no accents, single spaces (as `ingredients.name` is compared everywhere). */
export function normalizeProduceName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** «Setas» → «seta», «Judías verdes» → «judia verde», «Coles» → «col». */
function singular(normalized: string): string {
  return normalized
    .split(' ')
    .map((w) => {
      if (w.length > 4 && /[rnldzj]es$/.test(w)) return w.slice(0, -2)
      if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1)
      return w
    })
    .join(' ')
}

const termRegex = new Map<string, RegExp>()
function hasWord(normalizedName: string, term: string): boolean {
  let re = termRegex.get(term)
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`(^|[^a-z0-9])${escaped}(e?s)?($|[^a-z0-9])`)
    termRegex.set(term, re)
  }
  return re.test(normalizedName)
}

/** The products in season in a month (1–12), in calendar order. */
export function produceInSeason(month: number): SeasonalProduce[] {
  return SEASONAL_PRODUCE.filter((p) => p.months.includes(month))
}

/** The calendar product a name refers to («calabaza», «Setas», «castaña»…), if any. */
export function findProduce(name: string): SeasonalProduce | undefined {
  const n = normalizeProduceName(name)
  const s = singular(n)
  return SEASONAL_PRODUCE.find(
    (p) => normalizeProduceName(p.name) === n || p.terms.includes(n) || p.terms.includes(s),
  )
}

/**
 * Does an ingredient name count as this product? For a free name that is
 * not in the calendar (`GET /recipes?ingredient=garbanzos`), the name
 * itself is the term.
 */
export function ingredientMatchesProduce(ingredientName: string, product: SeasonalProduce | string): boolean {
  const n = normalizeProduceName(ingredientName)
  if (typeof product === 'string') {
    const term = singular(normalizeProduceName(product))
    return term.length > 0 && hasWord(n, term)
  }
  if (product.exclude?.some((x) => hasWord(n, x))) return false
  return product.terms.some((t) => hasWord(n, t))
}
