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
   * Override the search query. When provided, this string is sent to USDA
   * verbatim (no es→en translation). Curators use this to refine a poor
   * automatic translation.
   */
  query?: string
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

function inferAisleFromEnglishQuery(en: string): Aisle {
  const q = en.toLowerCase()
  for (const { aisle, needles } of AISLE_KEYWORDS) {
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
  // Last resort: pass the Spanish through. USDA's search is permissive.
  return n
}

// ─── DataType priority ───────────────────────────────────────────
// Foundation > SR Legacy > FNDDS. Branded is filtered out (per Task 5).

const DATA_TYPE_RANK: Record<string, number> = {
  Foundation: 0,
  'SR Legacy': 1,
  'Survey (FNDDS)': 2,
}

function rankDataType(dt: string): number {
  return DATA_TYPE_RANK[dt] ?? 99
}

// ─── Public API ─────────────────────────────────────────────────

let defaultClient: UsdaClient | null = null
function getDefaultClient(): UsdaClient {
  if (!defaultClient) defaultClient = createUsdaClient()
  return defaultClient
}

/**
 * Return USDA candidates for a given Spanish ingredient name plus
 * suggested aisle and allergens. Branded entries are filtered out.
 */
export async function suggestIngredient(
  name: string,
  opts?: SuggestOpts,
): Promise<AutoCreateSuggestion> {
  const limit = Math.max(1, Math.min(10, opts?.limit ?? 5))
  const client = opts?.client ?? getDefaultClient()
  const normalizedName = normalize(name)

  // If the curator passed an explicit query, use it verbatim. Otherwise
  // run the es→en translation as before.
  const queryOverride = opts?.query?.trim()
  const enQuery = queryOverride && queryOverride.length > 0
    ? queryOverride
    : translateEsToEn(name)

  // Ask USDA for a slightly larger pool — we'll filter Branded and re-sort.
  // USDA can return 4xx for short / weird queries (e.g. "beans" without
  // qualifier sometimes 400s). On any USDA failure we fall through to
  // BEDCA + estimation rather than 500ing the whole curator workflow.
  let search: Awaited<ReturnType<UsdaClient['searchByName']>> = []
  try {
    search = await client.searchByName(enQuery, {
      limit: Math.min(20, limit * 3),
      preferDataTypes: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'],
    })
  } catch (err) {
    console.warn(
      `[suggestIngredient] USDA search failed for "${enQuery}":`,
      (err as Error).message,
    )
  }

  const filtered = search
    .filter((r) => r.dataType !== 'Branded')
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

  // If USDA returned 0 candidates, fall back to BEDCA. The BEDCA shape
  // already returns Spanish descriptions and per-100 g values together,
  // so we don't need to translate them — `descriptionEs` mirrors
  // `description`.
  if (candidates.length === 0 && !opts?.skipFallbacks) {
    const bedcaResults = await safeSearchBedca(name, limit)
    for (const b of bedcaResults) {
      candidates.push({
        fdcId: null,
        bedcaId: b.bedcaId,
        description: b.description,
        descriptionEs: b.description,
        dataType: 'BEDCA',
        per100g: b.per100g,
      })
    }
  }

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
