/**
 * Smoke test for the USDA FoodData Central client.
 *
 * Skips entirely when USDA_FDC_API_KEY is not set (CI safety).
 * When the key is present, hits USDA once for fdcId 170000 (Onions, raw),
 * verifies the per-100 g shape, exercises the disk cache, and confirms
 * search returns at least one result.
 *
 * Run: pnpm --filter @ona/api test
 *  or: cd apps/api && npx vitest run src/tests/usdaClient.smoke.ts
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { createUsdaClient } from '../services/nutrition/usdaClient.js'

const KEY = process.env.USDA_FDC_API_KEY || ''
const HAS_KEY = KEY.length > 0
// "Onions, raw" — SR Legacy. (Task spec mentioned 173410, but that fdcId
// resolves to "Butter, salted" in the live USDA catalog. 170000 is the
// canonical raw onion entry per /foods/search and lands at ~40 kcal/100g,
// matching the plausibility band below.)
const ONION_FDC_ID = 170000

// Use a unique tmpdir per run so we have full control over cache state
// and never pollute the real apps/api/.cache during test runs.
async function makeTmpCacheDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ona-usda-smoke-'))
  return dir
}

describe('UsdaClient smoke', () => {
  if (!HAS_KEY) {
    it.skip('skipped: USDA_FDC_API_KEY not set', () => {
      // intentional: keeps CI green when the key is absent
    })
    return
  }

  it('fetchByFdcId(170000) returns a plausible per-100g profile', async () => {
    const cacheDir = await makeTmpCacheDir()
    const client = createUsdaClient({ cacheDir })

    const profile = await client.fetchByFdcId(ONION_FDC_ID)

    expect(profile.fdcId).toBe(ONION_FDC_ID)
    expect(typeof profile.description).toBe('string')
    expect(profile.description.toLowerCase()).toContain('onion')

    // Shape: all 6 fields present and finite numbers.
    expect(profile.per100g).toBeDefined()
    expect(typeof profile.per100g.kcal).toBe('number')
    expect(typeof profile.per100g.proteinG).toBe('number')
    expect(typeof profile.per100g.carbsG).toBe('number')
    expect(typeof profile.per100g.fatG).toBe('number')
    expect(typeof profile.per100g.fiberG).toBe('number')
    expect(typeof profile.per100g.saltG).toBe('number')

    // Plausibility: USDA "Onion, raw" (173410) sits around 40 kcal/100g.
    expect(profile.per100g.kcal).toBeGreaterThanOrEqual(35)
    expect(profile.per100g.kcal).toBeLessThanOrEqual(45)
    // Onion is mostly carbs, very low fat — sanity-check fat band.
    expect(profile.per100g.fatG).toBeLessThan(2)
    // Salt should be effectively negligible for raw onion.
    expect(profile.per100g.saltG).toBeLessThan(0.5)

    // Cache file should exist after the first fetch.
    const cachedFile = path.join(cacheDir, `${ONION_FDC_ID}.json`)
    const stat = await fs.stat(cachedFile)
    expect(stat.isFile()).toBe(true)
  }, 30_000)

  it('second fetchByFdcId hits the disk cache (fast path)', async () => {
    const cacheDir = await makeTmpCacheDir()
    const client = createUsdaClient({ cacheDir })

    // Warm the cache (network).
    await client.fetchByFdcId(ONION_FDC_ID)

    // Second call should be cache-only — measure to confirm it didn't
    // re-hit the network.
    const t0 = Date.now()
    const profile = await client.fetchByFdcId(ONION_FDC_ID)
    const elapsed = Date.now() - t0

    expect(profile.fdcId).toBe(ONION_FDC_ID)
    // Disk read of a small JSON should be well under 50ms; allow 200ms
    // for slow CI machines but still way faster than a real HTTP round trip.
    expect(elapsed).toBeLessThan(200)
  }, 30_000)

  it('searchByName("onion") returns at least one result', async () => {
    const client = createUsdaClient()
    const results = await client.searchByName('onion', { limit: 3 })
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThanOrEqual(1)
    for (const r of results) {
      expect(typeof r.fdcId).toBe('number')
      expect(typeof r.description).toBe('string')
      expect(typeof r.dataType).toBe('string')
    }
  }, 30_000)
})
