/**
 * USDA FoodData Central (FDC) API client.
 *
 * Fetches per-100 g nutrient profiles for a given fdcId, with on-disk caching
 * (one JSON file per fdcId under apps/api/.cache/usda/) plus an in-memory
 * promise cache so concurrent calls coalesce.
 *
 * Used by:
 *   - Task 6: nutrition aggregator (per-recipe totals)
 *   - Task 7: ingredient catalog seed
 *
 * Endpoint reference: https://fdc.nal.usda.gov/api-guide
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../../config/env.js'

// ─── Types ──────────────────────────────────────────────────────

export type UsdaNutrientProfile = {
  /** Source id */
  fdcId: number
  /** USDA description, kept for traceability */
  description: string
  /** Per 100 g unless otherwise specified */
  per100g: {
    kcal: number
    proteinG: number
    carbsG: number
    fatG: number
    fiberG: number
    saltG: number // computed from sodium_mg × 2.5 / 1000
  }
  /** Raw response from USDA, retained verbatim in the cache file */
  raw: unknown
}

export type UsdaSearchResult = {
  fdcId: number
  description: string
  dataType: string // 'Foundation' | 'SR Legacy' | 'Survey (FNDDS)' | 'Branded'
  publishedDate?: string
}

export interface UsdaClient {
  fetchByFdcId(fdcId: number): Promise<UsdaNutrientProfile>
  searchByName(
    query: string,
    opts?: { limit?: number; preferDataTypes?: string[] }
  ): Promise<UsdaSearchResult[]>
}

export class UsdaError extends Error {
  constructor(
    message: string,
    public readonly fdcId?: number,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'UsdaError'
  }
}

// ─── Constants ──────────────────────────────────────────────────

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1'

/**
 * USDA nutrient ids we care about. See:
 * https://fdc.nal.usda.gov/api-guide
 */
const NUTRIENT_IDS = {
  energyKcal: 1008,
  // Foundation entries report energy only as Atwater factors.
  energyAtwaterGeneral: 2047,
  energyAtwaterSpecific: 2048,
  proteinG: 1003,
  carbsG: 1005,
  fatG: 1004,
  fiberG: 1079,
  sodiumMg: 1093,
} as const

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// resolves to apps/api/.cache/usda/
const DEFAULT_CACHE_DIR = path.resolve(__dirname, '..', '..', '..', '.cache', 'usda')

// ─── Helpers ────────────────────────────────────────────────────

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const isRetriableStatus = (status: number) => status === 429 || status >= 500

const truncate = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n)}…` : s)

type CacheFile = { fetchedAt: string; profile: UsdaNutrientProfile }

async function readCache(cacheDir: string, fdcId: number): Promise<UsdaNutrientProfile | null> {
  const file = path.join(cacheDir, `${fdcId}.json`)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as CacheFile
    if (parsed && parsed.profile && typeof parsed.profile.fdcId === 'number') {
      // Re-parse the stored response, so a parser fix (Atwater energy,
      // 2026-10-21) reaches entries cached before it.
      const raw = parsed.profile.raw
      if (raw && typeof raw === 'object') {
        try {
          return parseProfile(raw as Record<string, unknown>, parsed.profile.fdcId)
        } catch {
          return parsed.profile
        }
      }
      return parsed.profile
    }
    return null
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    // Corrupt cache or parse error: treat as miss; do not throw.
    return null
  }
}

async function writeCache(cacheDir: string, profile: UsdaNutrientProfile): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true })
  const file = path.join(cacheDir, `${profile.fdcId}.json`)
  const payload: CacheFile = { fetchedAt: new Date().toISOString(), profile }
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8')
}

type FoodNutrient = {
  nutrient?: { id?: number; name?: string; unitName?: string }
  // Some USDA responses use a flatter shape on Branded/Survey:
  nutrientId?: number
  nutrientName?: string
  unitName?: string
  amount?: number
  value?: number
}

function findNutrient(food: { foodNutrients?: FoodNutrient[] }, id: number): number | undefined {
  const list = food.foodNutrients ?? []
  for (const fn of list) {
    const nid = fn.nutrient?.id ?? fn.nutrientId
    if (nid === id) {
      const amt = fn.amount ?? fn.value
      if (typeof amt === 'number') return amt
    }
  }
  return undefined
}

export function parseProfile(food: Record<string, unknown>, fdcId: number): UsdaNutrientProfile {
  const dataType = String(food.dataType ?? '')
  if (dataType === 'Branded') {
    throw new UsdaError(
      `fdcId=${fdcId} is a Branded entry; per-serving values would confuse per-100 g aggregation. Pick a Foundation/SR Legacy/Survey entry instead.`,
      fdcId
    )
  }

  const description = String(food.description ?? '')
  const foodLike = food as { foodNutrients?: FoodNutrient[] }

  const warnMissing = (label: string) => {
    console.warn(`[usda] missing nutrient ${label} for fdc=${fdcId}`)
  }

  const kcalRaw =
    findNutrient(foodLike, NUTRIENT_IDS.energyKcal) ??
    findNutrient(foodLike, NUTRIENT_IDS.energyAtwaterGeneral) ??
    findNutrient(foodLike, NUTRIENT_IDS.energyAtwaterSpecific)
  if (kcalRaw === undefined) warnMissing('Energy(kcal)')
  const proteinRaw = findNutrient(foodLike, NUTRIENT_IDS.proteinG)
  if (proteinRaw === undefined) warnMissing('Protein')
  const carbsRaw = findNutrient(foodLike, NUTRIENT_IDS.carbsG)
  if (carbsRaw === undefined) warnMissing('Carbohydrates')
  const fatRaw = findNutrient(foodLike, NUTRIENT_IDS.fatG)
  if (fatRaw === undefined) warnMissing('Fat')
  const fiberRaw = findNutrient(foodLike, NUTRIENT_IDS.fiberG)
  if (fiberRaw === undefined) warnMissing('Fiber')
  const sodiumMg = findNutrient(foodLike, NUTRIENT_IDS.sodiumMg)
  if (sodiumMg === undefined) warnMissing('Sodium')

  const saltG = sodiumMg !== undefined ? (sodiumMg * 2.5) / 1000 : 0
  // Carbs «by difference» can come out slightly negative (wings: -0.46).
  const carbsG = Math.max(0, carbsRaw ?? 0)
  // No energy reported at all: 4 kcal/g protein and carbs, 9 kcal/g fat.
  const kcal = kcalRaw ?? Math.round((proteinRaw ?? 0) * 4 + carbsG * 4 + (fatRaw ?? 0) * 9)

  return {
    fdcId,
    description,
    per100g: {
      kcal,
      proteinG: proteinRaw ?? 0,
      carbsG,
      fatG: fatRaw ?? 0,
      fiberG: fiberRaw ?? 0,
      saltG,
    },
    raw: food,
  }
}

// ─── Factory ────────────────────────────────────────────────────

export function createUsdaClient(opts?: { apiKey?: string; cacheDir?: string }): UsdaClient {
  const cacheDir = opts?.cacheDir ?? DEFAULT_CACHE_DIR
  // Resolve api key lazily so importing the module never throws.
  const resolveKey = (): string => {
    const key = opts?.apiKey ?? env.USDA_FDC_API_KEY
    if (!key) {
      throw new UsdaError(
        'USDA_FDC_API_KEY is not set. Add it to your .env (or pass opts.apiKey to createUsdaClient).'
      )
    }
    return key
  }

  // In-flight request coalescing: same fdcId requested twice in parallel
  // shares one promise.
  const inFlight = new Map<number, Promise<UsdaNutrientProfile>>()

  async function doFetch(fdcId: number): Promise<UsdaNutrientProfile> {
    const apiKey = resolveKey()
    const url = `${FDC_BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`

    let lastStatus: number | undefined
    let lastBody = ''
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      let res: Response
      try {
        res = await fetch(url)
      } catch (err) {
        // Network error — treat as retriable.
        lastBody = err instanceof Error ? err.message : String(err)
        if (attempt === RETRY_DELAYS_MS.length) {
          throw new UsdaError(
            `network error fetching fdc=${fdcId}: ${truncate(lastBody)}`,
            fdcId
          )
        }
        await wait(RETRY_DELAYS_MS[attempt])
        continue
      }

      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>
        const profile = parseProfile(json, fdcId)
        console.log(`[usda] fetched fdc=${fdcId}`)
        await writeCache(cacheDir, profile)
        return profile
      }

      lastStatus = res.status
      try {
        lastBody = await res.text()
      } catch {
        lastBody = ''
      }

      if (!isRetriableStatus(res.status) || attempt === RETRY_DELAYS_MS.length) {
        const msg = `USDA fetch failed for fdc=${fdcId} status=${res.status} body=${truncate(lastBody)}`
        console.error(`[usda] ${msg}`)
        throw new UsdaError(msg, fdcId, res.status)
      }
      await wait(RETRY_DELAYS_MS[attempt])
    }

    // Unreachable, but keep TS happy.
    throw new UsdaError(
      `USDA fetch exhausted retries for fdc=${fdcId} status=${lastStatus} body=${truncate(lastBody)}`,
      fdcId,
      lastStatus
    )
  }

  return {
    async fetchByFdcId(fdcId: number): Promise<UsdaNutrientProfile> {
      if (!Number.isInteger(fdcId) || fdcId <= 0) {
        throw new UsdaError(`invalid fdcId: ${fdcId}`)
      }

      // Disk cache first.
      const cached = await readCache(cacheDir, fdcId)
      if (cached) return cached

      // Coalesce concurrent fetches.
      const existing = inFlight.get(fdcId)
      if (existing) return existing

      const p = doFetch(fdcId).finally(() => {
        inFlight.delete(fdcId)
      })
      inFlight.set(fdcId, p)
      return p
    },

    async searchByName(
      query: string,
      opts?: { limit?: number; preferDataTypes?: string[] }
    ): Promise<UsdaSearchResult[]> {
      const apiKey = resolveKey()
      const limit = Math.max(1, Math.min(50, opts?.limit ?? 10))
      const types = opts?.preferDataTypes ?? []
      // USDA answers 400 to about half the searches that name «Survey
      // (FNDDS)» (2026-10-21; the same URL alternates 400/200). Try twice,
      // then without the types with parentheses, so auto-create doesn't
      // save an ingredient with no nutrition because of it.
      const plain = types.filter((t) => !t.includes('('))
      const attempts = plain.length < types.length ? [types, types, plain] : [types]

      let res: Response | null = null
      let lastMsg = ''
      for (const dataTypes of attempts) {
        const params = new URLSearchParams({
          query,
          pageSize: String(limit),
          api_key: apiKey,
        })
        // USDA allows repeated dataType params.
        for (const dt of dataTypes) params.append('dataType', dt)
        const url = `${FDC_BASE}/foods/search?${params.toString()}`
        try {
          res = await fetch(url)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new UsdaError(`USDA search network error: ${truncate(msg)}`)
        }
        if (res.ok) break
        let body = ''
        try {
          body = await res.text()
        } catch {
          /* ignore */
        }
        lastMsg = `USDA search failed status=${res.status} body=${truncate(body)}`
        if (res.status !== 400) break
      }

      if (!res || !res.ok) {
        console.error(`[usda] ${lastMsg}`)
        throw new UsdaError(lastMsg, undefined, res?.status)
      }

      const json = (await res.json()) as { foods?: Array<Record<string, unknown>> }
      const foods = json.foods ?? []
      return foods.map((f) => ({
        fdcId: Number(f.fdcId),
        description: String(f.description ?? ''),
        dataType: String(f.dataType ?? ''),
        publishedDate:
          typeof f.publishedDate === 'string' ? (f.publishedDate as string) : undefined,
      }))
    },
  }
}
