/**
 * Ingredient auto-create service.
 *
 * Given a Spanish ingredient name (e.g. "alcaparras"), translate it to an
 * English query, hit USDA `searchByName`, fetch per-100 g profiles for the
 * top candidates, and return a structured suggestion the UI can render.
 *
 * The service is pure: it does not touch the DB. The route handler decides
 * whether to dedupe / persist. The photo extractor and the apply script
 * reuse this same module.
 *
 * Reuses:
 *   - `usdaClient` (Task 5) — search + per-100 g fetch with on-disk cache
 *   - `inferAllergenTagsFromName` (Task 6) — pre-fills allergen tags
 *   - The es→en dictionary mirrors the curated list in
 *     `scripts/expandIngredientCatalog.ts`. Unknown words fall through as-is —
 *     USDA tolerates partial Spanish queries and we'd rather show a
 *     mediocre candidate than nothing.
 */

import {
  createUsdaClient,
  type UsdaClient,
  type UsdaNutrientProfile,
  type UsdaSearchResult,
} from './nutrition/usdaClient.js'
import { inferAllergenTagsFromName } from './nutrition/allergens.js'
import { searchBedca, type BedcaResult } from './nutrition/bedcaClient.js'
import { translateUsdaDescriptions } from './nutrition/usdaTranslator.js'
import type { Aisle, NutritionPerServing } from '@ona/shared'

// ─── Public types ────────────────────────────────────────────────

export interface AutoCreateCandidate {
  /** USDA fdcId; null for BEDCA-sourced rows */
  fdcId: number | null
  /** BEDCA food id; null for USDA-sourced rows */
  bedcaId: string | null
  /** Source description (English for USDA, Spanish for BEDCA) */
  description: string
  /** Spanish translation of `description` (null if translation skipped/failed) */
  descriptionEs: string | null
  /** 'Foundation' | 'SR Legacy' | 'Survey (FNDDS)' | 'BEDCA' */
  dataType: string
  per100g: NutritionPerServing
}

export interface AutoCreateSuggestion {
  /** lowercase + accent-stripped input */
  normalizedName: string
  /** Up to N candidates, Foundation/SR Legacy first */
  candidates: AutoCreateCandidate[]
  /** Inferred from English query keywords */
  suggestedAisle: Aisle
  /** Via inferAllergenTagsFromName(name) */
  suggestedAllergens: string[]
  /** The English query that was actually issued to USDA */
  queryUsed: string
}

export interface SuggestOpts {
  /** Max candidates returned (default 5) */
  limit?: number
  /** Override the underlying USDA client (tests, mocking) */
  client?: UsdaClient
  /**
   * Override the search query (the curator's manual search). It takes the
   * same path as the name: es→en for USDA (English passes through), and
   * Spanish for BEDCA.
   */
  query?: string
  /**
   * PRO-1125: search BEDCA too, not only when USDA finds nothing, and list
   * its entries first (the admin's remap modal).
   */
  alwaysBedca?: boolean
  /**
   * Skip BEDCA fallback and translation. Used by the test suite to keep
   * pure unit tests free of network/LLM side effects.
   */
  skipFallbacks?: boolean
}

// ─── ES → EN dictionary ──────────────────────────────────────────
// Hand-curated, mirrors `scripts/expandIngredientCatalog.ts`. Order
// doesn't matter; we look up by normalized Spanish key.

const ES_EN: Record<string, string> = {
  // Vegetables / produce
  acelgas: 'swiss chard raw',
  ajo: 'garlic raw',
  alcachofa: 'artichokes raw',
  alcachofas: 'artichokes raw',
  apio: 'celery raw',
  arandanos: 'blueberries raw',
  aguacate: 'avocados raw',
  berenjena: 'eggplant raw',
  boniato: 'sweet potato raw',
  brocoli: 'broccoli raw',
  calabacin: 'zucchini raw',
  calabaza: 'pumpkin raw',
  cebolla: 'onions raw',
  champinones: 'mushrooms white raw',
  coliflor: 'cauliflower raw',
  esparragos: 'asparagus raw',
  espinacas: 'spinach raw',
  fresa: 'strawberries raw',
  fresas: 'strawberries raw',
  frambuesas: 'raspberries raw',
  guisantes: 'peas green raw',
  judias: 'beans white mature seeds raw',
  'judias verdes': 'beans green raw',
  'judias blancas': 'beans white mature seeds raw',
  'judias rojas': 'beans kidney red raw',
  lechuga: 'lettuce iceberg raw',
  lima: 'limes raw',
  limon: 'lemons raw',
  mango: 'mango raw',
  manzana: 'apples raw',
  melon: 'melons cantaloupe raw',
  naranja: 'oranges raw',
  patata: 'potatoes raw',
  patatas: 'potatoes raw',
  pepino: 'cucumber raw',
  pera: 'pears raw',
  'pimiento rojo': 'peppers sweet red raw',
  'pimiento verde': 'peppers sweet green raw',
  pina: 'pineapple raw',
  platano: 'bananas raw',
  puerro: 'leeks raw',
  rabanitos: 'radishes raw',
  remolacha: 'beets raw',
  rucula: 'arugula raw',
  sandia: 'watermelon raw',
  setas: 'mushrooms portabella raw',
  tomate: 'tomatoes red raw',
  tomates: 'tomatoes red raw',
  uva: 'grapes raw',
  zanahoria: 'carrots raw',

  // Fresh herbs
  albahaca: 'basil fresh',
  cilantro: 'coriander leaves fresh',
  hierbabuena: 'spearmint fresh',
  laurel: 'bay leaves',
  menta: 'spearmint fresh',
  oregano: 'oregano dried',
  perejil: 'parsley fresh',
  romero: 'rosemary fresh',
  tomillo: 'thyme fresh',

  // Spices / aromatics
  azafran: 'spices saffron',
  canela: 'cinnamon ground',
  comino: 'cumin seed ground',
  curcuma: 'turmeric ground',
  guindilla: 'pepper hot chili red raw',
  'jengibre fresco': 'ginger root raw',
  'nuez moscada': 'nutmeg ground',
  'pimienta negra': 'pepper black ground',
  'pimenton dulce': 'paprika',
  'pimenton picante': 'spices paprika',
  sal: 'salt table',

  // Proteins
  atun: 'fish tuna fresh raw',
  bacalao: 'cod atlantic raw',
  buey: 'beef chuck raw',
  calamares: 'squid mixed species raw',
  cerdo: 'pork loin raw',
  conejo: 'rabbit domesticated raw',
  cordero: 'lamb leg raw',
  'costillas de cerdo': 'pork ribs raw',
  gambas: 'shrimp raw',
  huevo: 'eggs raw whole',
  huevos: 'eggs raw whole',
  jamon: 'ham cured',
  langostinos: 'shrimp raw',
  lomo: 'pork loin raw',
  mejillones: 'mussels blue raw',
  merluza: 'fish hake raw',
  pavo: 'turkey breast raw',
  pollo: 'chicken broiler breast raw',
  pulpo: 'octopus common raw',
  salmon: 'salmon atlantic raw',
  sardinas: 'fish sardine atlantic canned',
  seitan: 'wheat gluten',
  ternera: 'beef chuck raw',
  tempeh: 'tempeh',
  tofu: 'tofu raw firm',
  trucha: 'fish trout rainbow raw',

  // Dairy
  feta: 'cheese feta',
  leche: 'milk whole fluid',
  'leche desnatada': 'milk nonfat fluid',
  mantequilla: 'butter without salt',
  mozzarella: 'cheese mozzarella whole milk',
  nata: 'cream fluid heavy whipping',
  'nata liquida': 'cream fluid heavy whipping',
  parmesano: 'cheese parmesan grated',
  queso: 'cheese cheddar',
  'queso fresco': 'cheese cottage creamed',
  'queso de cabra': 'cheese goat soft',
  'queso manchego': 'cheese manchego',
  'queso cheddar': 'cheese cheddar',
  requeson: 'cheese ricotta whole milk',
  yogur: 'yogurt plain whole milk',

  // Pantry / despensa
  'aceite de oliva': 'oil olive',
  'aceite de girasol': 'oil sunflower',
  aceitunas: 'olives ripe canned',
  'aceitunas verdes': 'olives green canned',
  'aceitunas negras': 'olives ripe canned',
  alcaparras: 'capers canned',
  almendras: 'nuts almonds',
  arroz: 'rice white long grain raw',
  avellanas: 'nuts hazelnuts',
  azucar: 'sugars granulated',
  'caldo de pollo': 'soup stock chicken',
  'caldo de verduras': 'soup vegetable broth',
  cuscus: 'couscous dry',
  fideos: 'noodles egg dry',
  galletas: 'cookies plain',
  garbanzos: 'chickpeas mature seeds raw',
  harina: 'wheat flour white',
  ketchup: 'catsup',
  lentejas: 'lentils raw',
  levadura: 'leavening agents yeast bakers active dry',
  mayonesa: 'mayonnaise',
  miel: 'honey',
  mostaza: 'mustard prepared yellow',
  nueces: 'nuts walnuts english',
  pan: 'bread white commercially prepared',
  'pan blanco': 'bread white commercially prepared',
  pasas: 'raisins seedless',
  pasta: 'pasta dry',
  'pasta de tomate': 'tomato paste canned',
  pinones: 'nuts pine nuts dried',
  'pipas de girasol': 'seeds sunflower seed kernels dried',
  quinoa: 'quinoa uncooked',
  'salsa de soja': 'soy sauce',
  sesamo: 'seeds sesame whole',
  'sirope de arce': 'syrups maple',
  tahini: 'sesame butter tahini',
  'tomate triturado': 'tomatoes crushed canned',
  vinagre: 'vinegar distilled',
  'vinagre balsamico': 'vinegar balsamic',
  'vinagre de vino': 'vinegar red wine',
  'vino blanco': 'wine table white',
  'vino tinto': 'wine table red',

  // PRO-1125: names the household recipes had with no nutrition (5-nov)
  manitas: 'pork feet raw',
  'manitas de cerdo': 'pork feet raw',
  datiles: 'dates medjool',
  membrillo: 'quinces raw',
  hojaldre: 'puff pastry frozen ready-to-bake',
  'masa de hojaldre': 'puff pastry frozen ready-to-bake',
  mascarpone: 'cheese mascarpone',
}

// ─── Aisle inference ─────────────────────────────────────────────
// Crude keyword bucket. Returns 'otros' if nothing matches — same
// fallback the schema accepts.

const AISLE_KEYWORDS: Array<{ aisle: Aisle; needles: string[] }> = [
  {
    aisle: 'produce',
    needles: [
      'raw',
      'fresh',
      'lettuce',
      'spinach',
      'tomato',
      'onion',
      'pepper',
      'carrot',
      'cucumber',
      'apple',
      'banana',
      'berry',
      'grapes',
      'lemon',
      'lime',
      'orange',
      'mango',
      'pineapple',
      'melon',
      'watermelon',
      'mushroom',
      'leek',
      'beet',
      'radish',
      'arugula',
      'asparagus',
      'broccoli',
      'cauliflower',
      'pumpkin',
      'eggplant',
      'zucchini',
      'pepper',
      'celery',
      'artichoke',
      'avocado',
      'fruit',
      'vegetable',
      'parsley',
      'basil',
      'cilantro',
      'rosemary',
      'thyme',
      'mint',
    ],
  },
  {
    aisle: 'proteinas',
    needles: [
      'beef',
      'chicken',
      'pork',
      'turkey',
      'lamb',
      'rabbit',
      'fish',
      'salmon',
      'tuna',
      'cod',
      'hake',
      'trout',
      'shrimp',
      'mussels',
      'octopus',
      'squid',
      'tofu',
      'tempeh',
      'gluten',
      'sardine',
      'eggs',
    ],
  },
  {
    aisle: 'lacteos',
    needles: [
      'milk',
      'cream',
      'cheese',
      'yogurt',
      'butter',
      'mozzarella',
      'feta',
      'parmesan',
      'ricotta',
      'manchego',
    ],
  },
  {
    aisle: 'panaderia',
    needles: ['bread', 'baguette', 'roll'],
  },
  {
    aisle: 'congelados',
    needles: ['frozen'],
  },
]

const PANTRY_KEYWORDS = [
  'oil',
  'vinegar',
  'salt',
  'sugar',
  'flour',
  'rice',
  'pasta',
  'noodles',
  'beans',
  'lentil',
  'chickpea',
  'paprika',
  'cinnamon',
  'cumin',
  'turmeric',
  'pepper black',
  'mustard',
  'mayonnaise',
  'catsup',
  'honey',
  'syrup',
  'soy sauce',
  'tahini',
  'capers',
  'olives',
  'raisins',
  'nuts',
  'seeds',
  'tomato paste',
  'tomatoes crushed',
  'wine',
  'broth',
  'stock',
  'yeast',
  'couscous',
  'quinoa',
  'cookies',
]

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .trim()
}

// Produce last: its «raw» would take «pork feet raw» or «chicken … raw».
const AISLE_ORDER: readonly Aisle[] = ['proteinas', 'lacteos', 'panaderia', 'congelados', 'produce']

function inferAisleFromEnglishQuery(en: string): Aisle {
  const q = en.toLowerCase()
  const ordered = [...AISLE_KEYWORDS].sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle))
  for (const { aisle, needles } of ordered) {
    for (const n of needles) {
      if (q.includes(n)) return aisle
    }
  }
  for (const k of PANTRY_KEYWORDS) {
    if (q.includes(k)) return 'despensa'
  }
  return 'otros'
}

/**
 * Translate a Spanish ingredient name to an English search query.
 * Falls back to the original input if no entry matches — USDA tolerates
 * Spanish for many staples (it returns a poor ranking, but at least
 * something to show).
 */
export function translateEsToEn(name: string): string {
  const n = normalize(name)
  if (ES_EN[n]) return ES_EN[n]
  // Try the first word in case the user typed e.g. "alcaparras pequeñas".
  const first = n.split(/\s+/)[0]
  if (first && ES_EN[first]) return ES_EN[first]
  // PRO-1125: the longest known name inside it («pechuga de pollo» → pollo).
  const padded = ` ${n.replace(/\s+/g, ' ')} `
  let best: string | null = null
  for (const key of Object.keys(ES_EN)) {
    if (padded.includes(` ${key} `) && (!best || key.length > best.length)) best = key
  }
  if (best) return ES_EN[best]
  // Last resort: pass the Spanish through. USDA's search is permissive.
  return n
}

/** Aisle for a Spanish name without asking USDA (the household «Añadir»). */
export function suggestAisleForName(name: string): Aisle {
  return inferAisleFromEnglishQuery(translateEsToEn(name))
}

// ─── Candidate filter ────────────────────────────────────────────
// PRO-1125: only ingredients. Foundation > SR Legacy; Branded and the survey
// dishes (FNDDS) are out, and so are SR Legacy's dish categories — «cerdo»
// used to bring pupusas and restaurant stews.

const DATA_TYPE_RANK: Record<string, number> = {
  Foundation: 0,
  'SR Legacy': 1,
}

/** SR Legacy / Foundation categories that are dishes, not ingredients. */
export const DISH_FOOD_CATEGORIES: readonly string[] = [
  'Restaurant Foods',
  'Fast Foods',
  'Meals, Entrees, and Side Dishes',
  'Baby Foods',
]

function rankDataType(dt: string): number {
  return DATA_TYPE_RANK[dt] ?? 99
}

/** True for a USDA search hit that is an ingredient (not a dish, a brand or a survey food). */
export function isIngredientCandidate(r: Pick<UsdaSearchResult, 'dataType' | 'foodCategory'>): boolean {
  if (!Object.hasOwn(DATA_TYPE_RANK, r.dataType)) return false
  return !r.foodCategory || !DISH_FOOD_CATEGORIES.includes(r.foodCategory)
}

// ─── Public API ─────────────────────────────────────────────────

let defaultClient: UsdaClient | null = null
function getDefaultClient(): UsdaClient {
  if (!defaultClient) defaultClient = createUsdaClient()
  return defaultClient
}

/**
 * Return BEDCA + USDA candidates for a given Spanish ingredient name plus
 * suggested aisle and allergens. Only ingredients: Branded, FNDDS and the
 * dish categories are filtered out (`isIngredientCandidate`).
 */
export async function suggestIngredient(
  name: string,
  opts?: SuggestOpts,
): Promise<AutoCreateSuggestion> {
  const limit = Math.max(1, Math.min(10, opts?.limit ?? 5))
  const client = opts?.client ?? getDefaultClient()
  const normalizedName = normalize(name)

  // PRO-1125: the curator's manual search takes the same path as the
  // automatic one — translated to English for USDA (an English query passes
  // through), and searched in Spanish in BEDCA.
  const queryOverride = opts?.query?.trim()
  const spanishQuery = queryOverride && queryOverride.length > 0 ? queryOverride : name
  const enQuery = translateEsToEn(spanishQuery)

  // BEDCA (Spanish, in Spanish) goes first, in parallel with USDA, when asked
  // (`alwaysBedca`: the admin's suggest route); otherwise only if USDA has
  // nothing — the extractor and the imports call this once per ingredient
  // and BEDCA fetches each food in turn.
  const bedcaPromise =
    opts?.skipFallbacks || !opts?.alwaysBedca ? Promise.resolve([]) : safeSearchBedca(spanishQuery, limit)

  // Ask USDA for a slightly larger pool — we'll filter dishes and re-sort.
  // USDA can return 4xx for short / weird queries (e.g. "beans" without
  // qualifier sometimes 400s). On any USDA failure we fall through to
  // BEDCA + estimation rather than 500ing the whole curator workflow.
  let search: Awaited<ReturnType<UsdaClient['searchByName']>> = []
  try {
    search = await client.searchByName(enQuery, {
      limit: Math.min(25, limit * 4),
      preferDataTypes: ['Foundation', 'SR Legacy'],
    })
  } catch (err) {
    console.warn(
      `[suggestIngredient] USDA search failed for "${enQuery}":`,
      (err as Error).message,
    )
  }

  // Stable sort: USDA's relevance order within each data type.
  const filtered = search
    .filter(isIngredientCandidate)
    .sort((a, b) => rankDataType(a.dataType) - rankDataType(b.dataType))
    .slice(0, limit)

  // Fetch per-100 g for each candidate. Failures are dropped silently
  // so a single bad row doesn't tank the suggestion.
  const profiles = await Promise.allSettled(
    filtered.map((r) => client.fetchByFdcId(r.fdcId)),
  )

  const candidates: AutoCreateCandidate[] = []
  for (let i = 0; i < filtered.length; i++) {
    const result = filtered[i]
    const settled = profiles[i]
    if (settled.status !== 'fulfilled') continue
    const profile: UsdaNutrientProfile = settled.value
    candidates.push({
      fdcId: result.fdcId,
      bedcaId: null,
      description: result.description || profile.description,
      descriptionEs: null,
      dataType: result.dataType,
      per100g: profile.per100g,
    })
  }

  // BEDCA entries go first (Spanish food, Spanish names). The BEDCA shape
  // already returns Spanish descriptions and per-100 g values together, so
  // we don't need to translate them — `descriptionEs` mirrors `description`.
  let bedcaResults = await bedcaPromise
  if (candidates.length === 0 && bedcaResults.length === 0 && !opts?.skipFallbacks && !opts?.alwaysBedca) {
    bedcaResults = await safeSearchBedca(spanishQuery, limit)
  }
  candidates.unshift(
    ...bedcaResults.map((b) => ({
      fdcId: null,
      bedcaId: b.bedcaId,
      description: b.description,
      descriptionEs: b.description,
      dataType: 'BEDCA',
      per100g: b.per100g,
    })),
  )

  // Translate USDA English descriptions in a single batched Anthropic call.
  // Cached entries return instantly; only first-time descriptions cost a
  // network round trip. Failures (or missing API key) leave `descriptionEs`
  // as null and the UI falls back to the English string.
  if (!opts?.skipFallbacks) {
    const usdaIdxs: number[] = []
    const usdaTexts: string[] = []
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]
      if (c.dataType !== 'BEDCA' && c.descriptionEs == null) {
        usdaIdxs.push(i)
        usdaTexts.push(c.description)
      }
    }
    if (usdaTexts.length > 0) {
      try {
        const translations = await translateUsdaDescriptions(usdaTexts)
        for (let k = 0; k < usdaIdxs.length; k++) {
          candidates[usdaIdxs[k]].descriptionEs = translations[k] ?? null
        }
      } catch (err) {
        console.warn('[suggestIngredient] translation failed:', (err as Error).message)
      }
    }
  }

  return {
    normalizedName,
    candidates,
    suggestedAisle: inferAisleFromEnglishQuery(enQuery),
    suggestedAllergens: inferAllergenTagsFromName(name),
    queryUsed: enQuery,
  }
}

/**
 * The candidate whose nutrition a new ingredient takes: the first USDA
 * Foundation or SR Legacy one, else the first of any kind (FNDDS, BEDCA).
 * An entry with every value at zero (some Foundation samples carry no
 * nutrients) is skipped while another one has data; water keeps its zeros.
 * Used by auto-create and by `scripts/refillIngredientNutrition.ts`.
 */
export function pickNutritionCandidate(candidates: readonly AutoCreateCandidate[]): AutoCreateCandidate | null {
  const hasData = (c: AutoCreateCandidate) => Object.values(c.per100g).some((v) => v > 0)
  const pool = candidates.some(hasData) ? candidates.filter(hasData) : candidates
  return pool.find((c) => c.dataType === 'Foundation' || c.dataType === 'SR Legacy') ?? pool[0] ?? null
}

/** Wrap searchBedca so a thrown / hung scrape never crashes the suggestion. */
async function safeSearchBedca(
  name: string,
  limit: number,
): Promise<BedcaResult[]> {
  try {
    return await searchBedca(name, limit)
  } catch (err) {
    console.warn('[suggestIngredient] BEDCA fallback failed:', (err as Error).message)
    return []
  }
}

// ─── Levenshtein for dedupe ─────────────────────────────────────
// Pure ≤ 60 LOC implementation. Used by the route handler to detect
// near-duplicate names ("alcaparras" vs "alcaparra") before persisting.

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const m = a.length
  const n = b.length
  // Two-row dp.
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

export function normalizeForDedupe(s: string): string {
  return normalize(s).replace(/\s+/g, ' ')
}

// ─── Similar catalogue names ────────────────────────────────────
// PRO-1125: what the household sees when its word isn't in the catalogue
// («¿Es manitas de cerdo?») before «Añadir».

const SIMILAR_STOPWORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'con', 'en', 'y', 'a', 'al'])

function words(s: string): string[] {
  return normalizeForDedupe(s)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 2 && !SIMILAR_STOPWORDS.has(w))
}

/** A typed word against a catalogue word: same, a prefix of 3+ letters, or a typo away. */
function wordMatches(typed: string, word: string): boolean {
  if (typed === word) return true
  if (typed.length >= 3 && word.startsWith(typed)) return true
  if (typed.length < 4 || Math.abs(typed.length - word.length) > 2) return false
  return levenshtein(typed, word) <= (typed.length >= 6 ? 2 : 1)
}

/**
 * Catalogue rows that look like what was typed, best first: more typed words
 * found, then the shorter name. Each typed word that isn't a stopword counts
 * once; the same name (other capitals, accents) goes first. Pure: the route
 * passes the whole catalogue.
 */
export function similarIngredients<T extends { name: string }>(
  typed: string,
  rows: readonly T[],
  limit = 5,
): T[] {
  const typedWords = [...new Set(words(typed))]
  if (typedWords.length === 0) return []
  const typedNorm = normalizeForDedupe(typed)
  const scored: Array<{ row: T; score: number }> = []
  for (const row of rows) {
    // The same name with other capitals or accents goes first.
    if (normalizeForDedupe(row.name) === typedNorm) {
      scored.push({ row, score: Number.MAX_SAFE_INTEGER })
      continue
    }
    const rowWords = words(row.name)
    const score = typedWords.filter((t) => rowWords.some((w) => wordMatches(t, w))).length
    if (score > 0) scored.push({ row, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.row.name.length - b.row.name.length || a.row.name.localeCompare(b.row.name, 'es'))
    .slice(0, limit)
    .map((s) => s.row)
}
