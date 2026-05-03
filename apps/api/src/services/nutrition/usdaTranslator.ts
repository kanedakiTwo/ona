/**
 * USDA description translator.
 *
 * Translates English USDA descriptions ("Pork sausage, fresh, cooked") to
 * Spanish for curators ("Salchicha de cerdo, fresca, cocinada"). USDA
 * descriptions follow a comma-separated, terse style — Haiku handles them
 * well in batches.
 *
 * Caching strategy:
 *   - In-memory map for the lifetime of the process
 *   - Disk cache under apps/api/.cache/translations/usda/<sha1>.json
 *   - Hash key = raw English string (lowercased + trimmed)
 *
 * If `ANTHROPIC_API_KEY` is missing, the translator no-ops and returns
 * `null` for every entry. Callers must tolerate `null` and fall back to
 * showing the English description.
 *
 * We batch up to BATCH_MAX entries per Anthropic call to reduce token
 * overhead — Haiku is cheap but each translate call is ~50 tokens of
 * preamble per request, so batching saves ~5x.
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_CACHE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.cache',
  'translations',
  'usda',
)

const BATCH_MAX = 5
const MODEL = 'claude-haiku-4-5-20251001'

// In-memory cache, keyed by sha1(en).
const memCache = new Map<string, string>()

function hashKey(en: string): string {
  return crypto.createHash('sha1').update(en.toLowerCase().trim()).digest('hex')
}

async function readDiskCache(
  cacheDir: string,
  key: string,
): Promise<string | null> {
  const file = path.join(cacheDir, `${key}.json`)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as { es?: string }
    return parsed.es ?? null
  } catch {
    return null
  }
}

async function writeDiskCache(
  cacheDir: string,
  key: string,
  en: string,
  es: string,
): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true })
  const file = path.join(cacheDir, `${key}.json`)
  await fs.writeFile(
    file,
    JSON.stringify({ en, es, fetchedAt: new Date().toISOString() }, null, 2),
    'utf8',
  )
}

let cachedClient: Anthropic | null = null
function getClient(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null
  if (!cachedClient) cachedClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return cachedClient
}

/**
 * Translate a list of USDA English descriptions to Spanish.
 *
 * Returns an array aligned with `descriptions.length`. Untranslatable or
 * skipped entries become `null`. Cached entries are returned without
 * touching Anthropic.
 */
export async function translateUsdaDescriptions(
  descriptions: string[],
  opts?: { cacheDir?: string },
): Promise<Array<string | null>> {
  const cacheDir = opts?.cacheDir ?? DEFAULT_CACHE_DIR
  const out: Array<string | null> = new Array(descriptions.length).fill(null)

  // Resolve cache hits first; collect indices that still need a network round.
  const pending: Array<{ idx: number; en: string; key: string }> = []
  for (let i = 0; i < descriptions.length; i++) {
    const raw = descriptions[i]
    if (!raw || !raw.trim()) {
      out[i] = null
      continue
    }
    const key = hashKey(raw)
    const fromMem = memCache.get(key)
    if (fromMem) {
      out[i] = fromMem
      continue
    }
    const fromDisk = await readDiskCache(cacheDir, key)
    if (fromDisk) {
      memCache.set(key, fromDisk)
      out[i] = fromDisk
      continue
    }
    pending.push({ idx: i, en: raw, key })
  }

  if (pending.length === 0) return out

  const client = getClient()
  if (!client) {
    // No API key — leave the rest as null.
    return out
  }

  // Batch in chunks of BATCH_MAX. Each batch: a single user message
  // listing the items; respond with a JSON array of strings, in order.
  for (let start = 0; start < pending.length; start += BATCH_MAX) {
    const batch = pending.slice(start, start + BATCH_MAX)
    const numbered = batch
      .map((b, i) => `${i + 1}. ${b.en}`)
      .join('\n')

    const userMsg = `Traduce las siguientes descripciones de alimentos USDA al español natural y conciso.
Mantén el estilo USDA (frases cortas, separadas por comas).
Responde SOLO con un JSON array de strings, en el mismo orden, sin texto adicional.

${numbered}`

    let translated: Array<string | null> = batch.map(() => null)
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 60 * batch.length, // ~60 tokens per item is plenty for terse USDA strings
        messages: [{ role: 'user', content: userMsg }],
      })
      const block = response.content.find((b) => b.type === 'text')
      if (block && block.type === 'text') {
        const text = block.text.trim()
        // Tolerate fences / surrounding prose.
        const m = text.match(/\[[\s\S]*\]/)
        if (m) {
          try {
            const parsed = JSON.parse(m[0]) as unknown
            if (Array.isArray(parsed)) {
              translated = parsed.slice(0, batch.length).map((v) =>
                typeof v === 'string' && v.trim() ? v.trim() : null,
              )
            }
          } catch {
            /* parse failure → leave nulls */
          }
        }
      }
    } catch (err) {
      console.warn(
        `[usda-translator] batch failed (${batch.length} items):`,
        (err as Error).message,
      )
    }

    // Write through cache + assign.
    for (let i = 0; i < batch.length; i++) {
      const es = translated[i]
      if (!es) continue
      const { idx, en, key } = batch[i]
      memCache.set(key, es)
      out[idx] = es
      await writeDiskCache(cacheDir, key, en, es).catch(() => {})
    }
  }

  return out
}
