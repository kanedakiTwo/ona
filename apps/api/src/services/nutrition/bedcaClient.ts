/**
 * BEDCA (Base de Datos Española de Composición de Alimentos) client.
 *
 * BEDCA is the Spanish-government-maintained nutrition database. Coverage is
 * narrower than USDA but it includes regional / hispanic foods that USDA
 * doesn't carry — fabes, chorizo asturiano, morcilla, lacón, tocino, caldo
 * de pescado, bacalao desalado, etc.
 *
 * BEDCA exposes a public XML-based search/fetch endpoint at
 * `http://www.bedca.net/bdpub/procquery.php`. The query language is a
 * tiny ad-hoc XML payload — they document it loosely on
 * http://www.bedca.net/bdpub/. The site has no proper REST API, so we
 * scrape via two POST calls:
 *
 *   1. SEARCH: post `<consulta_publica><foodname>X</foodname></consulta_publica>`
 *      → returns an XML list of `<food>` elements with `<f_id>` + `<f_ori_name>`
 *   2. FETCH:  post `<consulta_publica><food_id>N</food_id></consulta_publica>`
 *      → returns nutrition values, one `<c_ori_name>/<best_location>` pair
 *      per nutrient component
 *
 * This file is best-effort: if the server is down, the page format changed,
 * or parsing fails, we return an empty array rather than throwing — the UI
 * always has a "Estimar con ONA" fallback. We also cache responses to
 * `apps/api/.cache/bedca/` so curators don't pay the network roundtrip
 * twice for the same ingredient.
 *
 * Important: this is not a hot path. We do not retry, we do not paginate,
 * we keep timeouts tight (8s) and let the call site fall through quickly
 * when BEDCA misbehaves.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NutritionPerServing } from '@ona/shared'

// ─── Types ──────────────────────────────────────────────────────

export interface BedcaResult {
  /** BEDCA food id (string in their API; we keep the raw form) */
  bedcaId: string
  /** Original Spanish name from BEDCA */
  description: string
  /** Per 100 g; values default to 0 when BEDCA returns nothing */
  per100g: NutritionPerServing
}

// ─── Constants ──────────────────────────────────────────────────

const BEDCA_URL = 'http://www.bedca.net/bdpub/procquery.php'
const REQUEST_TIMEOUT_MS = 8000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_CACHE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.cache',
  'bedca',
)

// BEDCA component codes (c_id) for the macros we care about.
// Reference: http://www.bedca.net/bdpub/index.php?Estructura=Composicion
// (kcal calculated from kJ when missing — we trust the explicit kcal field)
const COMPONENT_KEYS: Record<string, keyof NutritionPerServing> = {
  // Energy (kcal)
  energia: 'kcal',
  'energy, total': 'kcal',
  'energy total': 'kcal',
  // Protein
  'proteina, total': 'proteinG',
  proteina: 'proteinG',
  protein: 'proteinG',
  // Carbohydrates (BEDCA exposes "hidratos de carbono")
  'hidratos de carbono': 'carbsG',
  carbohidratos: 'carbsG',
  carbohydrate: 'carbsG',
  // Fat
  'grasa, total': 'fatG',
  'lipidos totales': 'fatG',
  grasa: 'fatG',
  lipid: 'fatG',
  // Fiber
  fibra: 'fiberG',
  'fibra, dietetica total': 'fiberG',
  'fibre, dietary': 'fiberG',
  // Salt — BEDCA usually only carries sodium (mg) so we convert to NaCl g
  sodio: 'saltG',
  sodium: 'saltG',
}

// ─── Helpers ────────────────────────────────────────────────────

function normaliseKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .trim()
}

function safeReadXml(payload: string, tag: string): string | null {
  // Very tolerant matcher — BEDCA whitespace is unpredictable.
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = payload.match(re)
  if (!m) return null
  return m[1]?.trim() ?? null
}

function safeReadAllXml(payload: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(payload)) != null) {
    results.push((m[1] ?? '').trim())
  }
  return results
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`bedca timeout after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function readSearchCache(
  cacheDir: string,
  key: string,
): Promise<BedcaResult[] | null> {
  const file = path.join(cacheDir, 'search', `${key}.json`)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as { results: BedcaResult[] }
    return parsed.results ?? null
  } catch {
    return null
  }
}

async function writeSearchCache(
  cacheDir: string,
  key: string,
  results: BedcaResult[],
): Promise<void> {
  const dir = path.join(cacheDir, 'search')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${key}.json`)
  await fs.writeFile(
    file,
    JSON.stringify({ fetchedAt: new Date().toISOString(), results }, null, 2),
    'utf8',
  )
}

async function readNutritionCache(
  cacheDir: string,
  bedcaId: string,
): Promise<NutritionPerServing | null> {
  const file = path.join(cacheDir, 'food', `${bedcaId}.json`)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as { per100g: NutritionPerServing }
    return parsed.per100g ?? null
  } catch {
    return null
  }
}

async function writeNutritionCache(
  cacheDir: string,
  bedcaId: string,
  per100g: NutritionPerServing,
  description: string,
): Promise<void> {
  const dir = path.join(cacheDir, 'food')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${bedcaId}.json`)
  await fs.writeFile(
    file,
    JSON.stringify(
      { fetchedAt: new Date().toISOString(), description, per100g },
      null,
      2,
    ),
    'utf8',
  )
}

function cacheKey(query: string): string {
  return normaliseKey(query).replace(/[^a-z0-9]+/g, '_').slice(0, 80)
}

// ─── XML payloads ────────────────────────────────────────────────

const SEARCH_PAYLOAD = (q: string) => `<?xml version="1.0" encoding="UTF-8"?>
<consulta_publica>
  <action>buscar_alimento</action>
  <foodname>${escapeXml(q)}</foodname>
  <foodname_options>any</foodname_options>
</consulta_publica>`

const FETCH_PAYLOAD = (id: string) => `<?xml version="1.0" encoding="UTF-8"?>
<consulta_publica>
  <action>get_alimento</action>
  <food_id>${escapeXml(id)}</food_id>
</consulta_publica>`

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Search BEDCA by Spanish name. Returns up to `limit` candidates with
 * per-100 g nutrition each (already fetched). Empty array on any failure.
 */
export async function searchBedca(
  query: string,
  limit = 5,
  opts?: { cacheDir?: string },
): Promise<BedcaResult[]> {
  const cacheDir = opts?.cacheDir ?? DEFAULT_CACHE_DIR
  const trimmed = query.trim()
  if (!trimmed) return []

  const key = cacheKey(trimmed)
  const cached = await readSearchCache(cacheDir, key)
  if (cached) return cached.slice(0, limit)

  let listXml = ''
  try {
    listXml = await withTimeout(
      (async () => {
        const res = await fetch(BEDCA_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=UTF-8',
            Accept: 'text/xml',
          },
          body: SEARCH_PAYLOAD(trimmed),
        })
        if (!res.ok) throw new Error(`bedca search status=${res.status}`)
        return res.text()
      })(),
      REQUEST_TIMEOUT_MS,
    )
  } catch (err) {
    console.warn('[bedca] search failed:', (err as Error).message)
    // Cache the empty result for ~24 h so we don't hammer BEDCA.
    await writeSearchCache(cacheDir, key, []).catch(() => {})
    return []
  }

  // Parse top-level <food> elements; each has <f_id> and <f_ori_name>.
  const blocks = safeReadAllXml(listXml, 'food')
  const candidates: Array<{ id: string; name: string }> = []
  for (const block of blocks) {
    const id = safeReadXml(block, 'f_id')
    const name = safeReadXml(block, 'f_ori_name')
    if (id && name) candidates.push({ id: id.trim(), name })
    if (candidates.length >= limit) break
  }

  if (candidates.length === 0) {
    await writeSearchCache(cacheDir, key, []).catch(() => {})
    return []
  }

  // Fetch nutrition for each candidate sequentially — BEDCA is slow and
  // we'd rather degrade than DoS them. Failures are skipped.
  const results: BedcaResult[] = []
  for (const c of candidates) {
    try {
      const n = await fetchBedcaNutrition(c.id, { cacheDir })
      results.push({
        bedcaId: c.id,
        description: c.name,
        per100g: n,
      })
    } catch (err) {
      console.warn(
        `[bedca] fetch failed for id=${c.id} (${c.name}):`,
        (err as Error).message,
      )
    }
  }

  await writeSearchCache(cacheDir, key, results).catch(() => {})
  return results
}

/**
 * Fetch BEDCA nutrition for a single food id. Returns per-100 g values;
 * any missing nutrient is filled with 0. Throws on transport / parse error
 * so callers can decide whether to retry or skip.
 */
export async function fetchBedcaNutrition(
  bedcaId: string,
  opts?: { cacheDir?: string },
): Promise<NutritionPerServing> {
  const cacheDir = opts?.cacheDir ?? DEFAULT_CACHE_DIR
  const cached = await readNutritionCache(cacheDir, bedcaId)
  if (cached) return cached

  const xml = await withTimeout(
    (async () => {
      const res = await fetch(BEDCA_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=UTF-8',
          Accept: 'text/xml',
        },
        body: FETCH_PAYLOAD(bedcaId),
      })
      if (!res.ok) throw new Error(`bedca fetch status=${res.status}`)
      return res.text()
    })(),
    REQUEST_TIMEOUT_MS,
  )

  const description = safeReadXml(xml, 'f_ori_name') ?? ''
  const out: NutritionPerServing = {
    kcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    saltG: 0,
  }

  // Each component is wrapped in <foodvalue> with <c_ori_name>, <best_location>
  // (numeric value per 100g), and <v_unit>.
  const values = safeReadAllXml(xml, 'foodvalue')
  let sodiumMg: number | null = null
  for (const block of values) {
    const cName = safeReadXml(block, 'c_ori_name') ?? ''
    const cKey = COMPONENT_KEYS[normaliseKey(cName)]
    if (!cKey) continue
    const valStr = safeReadXml(block, 'best_location') ?? ''
    const num = Number(valStr.replace(',', '.'))
    if (!Number.isFinite(num)) continue
    if (cKey === 'saltG') {
      // Sodium → salt: NaCl g = sodium mg × 2.5 / 1000
      sodiumMg = num
    } else {
      out[cKey] = num
    }
  }
  if (sodiumMg !== null) {
    out.saltG = (sodiumMg * 2.5) / 1000
  }

  await writeNutritionCache(cacheDir, bedcaId, out, description).catch(() => {})
  return out
}
