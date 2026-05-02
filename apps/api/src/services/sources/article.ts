/**
 * Article source extractor.
 *
 * Two-tier strategy:
 *   1. Try to parse a `schema.org/Recipe` JSON-LD blob from the HTML.
 *      Most recipe blogs (WordPress + recipe plugins) emit this; it's free,
 *      deterministic, and zero LLM cost.
 *   2. If absent, run Mozilla Readability over the article body, send the
 *      cleaned text to Claude (`extractRecipeFromText`) and use whatever the
 *      LLM returns (including `isRecipe: false`).
 *
 * The pure JSON-LD parser is exported so it can be unit-tested without
 * spinning up the LLM or hitting the network.
 */

import type {
  RawExtractedRecipe,
  TextExtractionProvider,
} from '../recipeExtractor.js'

// ─── ISO 8601 duration → minutes ─────────────────────────────────

/**
 * Convert an ISO 8601 duration string (e.g. `"PT1H30M"`) to total minutes.
 * Returns null for unparseable input. Schema.org uses the same format for
 * `prepTime`, `cookTime`, `totalTime`.
 */
function parseIsoDurationToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m) return null
  const [, d, h, min] = m
  const days = d ? parseInt(d, 10) : 0
  const hours = h ? parseInt(h, 10) : 0
  const minutes = min ? parseInt(min, 10) : 0
  const total = days * 24 * 60 + hours * 60 + minutes
  return total > 0 ? total : null
}

// ─── recipeYield → servings ──────────────────────────────────────

function parseServings(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }
  if (typeof value === 'string') {
    const m = value.match(/(\d+)/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > 0) return n
    }
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const n = parseServings(v)
      if (n != null) return n
    }
  }
  return null
}

// ─── recipeInstructions → string[] ───────────────────────────────

interface HowToStep {
  '@type'?: string
  text?: string
  name?: string
  itemListElement?: HowToStep[]
}

function flattenInstructions(input: unknown): string[] {
  if (!input) return []
  if (typeof input === 'string') {
    return input
      .split(/\r?\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  if (Array.isArray(input)) return input.flatMap(flattenInstructions)
  if (typeof input === 'object') {
    const node = input as HowToStep
    if (node['@type'] === 'HowToSection' && Array.isArray(node.itemListElement)) {
      return flattenInstructions(node.itemListElement)
    }
    if (typeof node.text === 'string' && node.text.trim().length > 0) {
      return [node.text.trim()]
    }
  }
  return []
}

// ─── recipeIngredient → RawExtractedRecipe shape ─────────────────

/**
 * Lightweight parser for Spanish/English `recipeIngredient` strings emitted
 * by recipe blogs. Tries to split a free-form string into `{name, quantity,
 * unit}` so the lint validator (which checks per-serving gramajes and
 * cross-references step text) has something to work with.
 *
 * Handles:
 *   - "<num><unit> <name>"      → "450g Fabes" / "1count Laurel" (joined; directoalpaladar style)
 *   - "<num> <unit> <name>"     → "200 g Lacón" / "250 ml leche"
 *   - "<num> <name>"            → "2 dientes de ajo" → counted unit
 *   - "<name>"                  → "aceite de oliva" → al_gusto
 *
 * Unknown / un-quantified strings degrade to `unit: 'al_gusto'` instead of
 * `'g'` with quantity 0, so QUANTITY_OUT_OF_RANGE doesn't trip on them.
 */
export function parseIngredientString(input: string): {
  name: string
  quantity: number
  unit: string
} {
  const raw = input.trim().replace(/\s+/g, ' ')
  if (raw.length === 0) return { name: '', quantity: 0, unit: 'al_gusto' }

  // <num><unit> <name>  —  joined form: 450g Fabes, 1count Laurel
  const joined = raw.match(
    /^(\d+(?:[.,]\d+)?)(g|kg|ml|l|count|u|ud)\s+(.+)$/i,
  )
  // <num> <unit-word> <name>  —  spaced form
  const spaced = raw.match(
    /^(\d+(?:[.,]\d+)?)\s+(g|gramos?|kg|kilos?|kilogramos?|ml|mililitros?|l|litros?|cdas?\.?|cucharadas?|cditas?\.?|cucharaditas?|count|u|uds?\.?|unidades?|piezas?|dientes?)\s+(?:de\s+)?(.+)$/i,
  )
  // <num> <name>  —  no unit; counted item
  const counted = raw.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/)

  let qty = 0
  let unit = 'al_gusto'
  let name = raw

  const m = joined ?? spaced ?? counted
  if (m) {
    qty = parseFloat(m[1].replace(',', '.'))
    if (!Number.isFinite(qty)) qty = 0
    if (joined || spaced) {
      const u = m[2].toLowerCase()
      if (u === 'g' || /^gramos?$/.test(u)) unit = 'g'
      else if (u === 'kg' || /^kilos?$/.test(u) || /^kilogramos?$/.test(u)) {
        unit = 'g'
        qty = qty * 1000
      } else if (u === 'ml' || /^mililitros?$/.test(u)) unit = 'ml'
      else if (u === 'l' || /^litros?$/.test(u)) {
        unit = 'ml'
        qty = qty * 1000
      } else if (/^cditas?\.?$/.test(u) || /^cucharaditas?$/.test(u)) {
        unit = 'cdita'
      } else if (/^cdas?\.?$/.test(u) || /^cucharadas?$/.test(u)) {
        unit = 'cda'
      } else if (
        u === 'count' ||
        u === 'u' ||
        /^uds?\.?$/.test(u) ||
        /^unidades?$/.test(u) ||
        /^piezas?$/.test(u)
      ) {
        unit = 'u'
      } else if (/^dientes?$/.test(u)) {
        // Treat "2 dientes de ajo" as 2u; keep "dientes de" out of the name.
        unit = 'u'
        name = `dientes de ${m[3]}`
        return {
          name: name.trim().toLowerCase(),
          quantity: qty,
          unit,
        }
      } else {
        unit = 'g'
      }
      name = m[3]
    } else {
      // counted form (no unit): assume whole pieces
      unit = 'u'
      name = m[2]
    }
  }

  // Drop trailing parenthetical notes ("cebolla (mediana)") for cleanliness.
  name = name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
  // Strip leading "de " left over from "<num> <unit> de <name>" forms that
  // didn't catch the optional `de\s+` group (defensive).
  name = name.replace(/^de\s+/, '')
  return { name, quantity: qty, unit }
}

/**
 * Schema.org `recipeIngredient` is a flat array of strings like
 * `"4 huevos"`, `"2 patatas medianas"`. We parse each one into
 * `{name, quantity, unit}` so downstream lint + nutrition aggregation work.
 * Unparseable strings degrade to `al_gusto`.
 */
function buildRawIngredients(
  list: unknown,
): { name: string; quantity: number; unit: string }[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => parseIngredientString(s.trim()))
    .filter((p) => p.name.length > 0)
}

// ─── JSON-LD walker ──────────────────────────────────────────────

function isRecipeNode(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== 'object') return false
  const t = (node as { '@type'?: unknown })['@type']
  if (typeof t === 'string') return t.toLowerCase() === 'recipe'
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.toLowerCase() === 'recipe')
  return false
}

function findRecipeNode(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (isRecipeNode(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findRecipeNode(item)
      if (hit) return hit
    }
    return null
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (Array.isArray(obj['@graph'])) {
      const hit = findRecipeNode(obj['@graph'])
      if (hit) return hit
    }
  }
  return null
}

function extractScriptBlocks(html: string): string[] {
  const out: string[] = []
  const re =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    out.push(m[1])
  }
  return out
}

/**
 * Public: extract a recipe from any embedded `schema.org/Recipe` JSON-LD
 * blob in the page. Returns null when absent, the JSON is malformed, or
 * the page has no JSON-LD at all.
 */
export function parseJsonLdRecipe(html: string): RawExtractedRecipe | null {
  const blocks = extractScriptBlocks(html)
  if (blocks.length === 0) return null

  for (const raw of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.trim())
    } catch {
      continue // malformed block; try the next one
    }
    const node = findRecipeNode(parsed)
    if (!node) continue

    const name = typeof node.name === 'string' ? node.name.trim() : ''
    if (name.length === 0) continue

    return {
      name,
      prepTime: parseIsoDurationToMinutes(node.prepTime),
      cookTime: parseIsoDurationToMinutes(node.cookTime),
      servings: parseServings(node.recipeYield),
      difficulty: null,
      ingredients: buildRawIngredients(node.recipeIngredient),
      steps: flattenInstructions(node.recipeInstructions),
      suggestedMeals: ['lunch', 'dinner'],
      suggestedSeasons: ['spring', 'summer', 'autumn', 'winter'],
      tags: [],
    }
  }
  return null
}

// ─── Network + Readability fallback ──────────────────────────────

export type ArticleFetcher = (url: string) => Promise<string>

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; OnaRecipeImporter/1.0; +https://ona.app)'

const defaultFetchArticle: ArticleFetcher = async (url) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html,*/*' },
      signal: ctrl.signal,
    })
    if (!res.ok) {
      throw new Error(`No se pudo descargar la página (HTTP ${res.status}).`)
    }
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/** Truncate the article body before sending to Claude — same budget the photo prompt uses. */
const MAX_TEXT_CHARS = 12_000

async function readableText(html: string): Promise<string> {
  // Lazy-import Readability + jsdom so the JSON-LD path never has to load them.
  const [{ Readability }, { JSDOM }] = await Promise.all([
    import('@mozilla/readability'),
    import('jsdom'),
  ])
  const dom = new JSDOM(html)
  const reader = new Readability(dom.window.document)
  const article = reader.parse()
  const text = article?.textContent ?? dom.window.document.body.textContent ?? ''
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS)
}

export type ArticleExtractionResult =
  | { isRecipe: true; raw: RawExtractedRecipe }
  | { isRecipe: false; reason: string }

export interface ArticleExtractDeps {
  provider: TextExtractionProvider
  fetchArticle?: ArticleFetcher
}

export async function extractArticleRecipe(
  url: string,
  deps: ArticleExtractDeps,
): Promise<ArticleExtractionResult> {
  const fetcher = deps.fetchArticle ?? defaultFetchArticle
  const html = await fetcher(url)

  // Tier 1: JSON-LD (free, deterministic).
  const jsonLd = parseJsonLdRecipe(html)
  if (jsonLd) return { isRecipe: true, raw: jsonLd }

  // Tier 2: Readability + LLM.
  const text = await readableText(html)
  if (text.length < 200) {
    return {
      isRecipe: false,
      reason: 'No se pudo extraer suficiente contenido del artículo.',
    }
  }
  return await deps.provider.extractRecipeFromText(text, 'article')
}
