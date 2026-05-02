/**
 * Smoke test for the /ingredients/auto-create route.
 *
 * Skips entirely when the API server isn't reachable on localhost:8000
 * (same pattern as recipesRoute.smoke.ts) or when SMOKE_USER_TOKEN is
 * absent — auth is required.
 *
 * Covers:
 *   - POST /ingredients/auto-create with a brand-new name persists a row
 *   - Re-running the same name fuzzy-dedupes back to the same row
 *
 * Run: pnpm --filter @ona/api test
 */

import { describe, it, expect, beforeAll } from 'vitest'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'
const TEST_USER_TOKEN = process.env.SMOKE_USER_TOKEN ?? ''

async function isApiReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const r = await fetch(`${API_URL}/health`, { signal: ctrl.signal }).catch(() => null)
    clearTimeout(t)
    return r != null
  } catch {
    return false
  }
}

describe('ingredients/auto-create smoke', () => {
  let reachable = false

  beforeAll(async () => {
    reachable = (await isApiReachable()) && TEST_USER_TOKEN.length > 0
  })

  it.skipIf(!reachable)('POST /ingredients/auto-create persists a stub row + dedupes on re-run', async () => {
    const uniqueName = `smoke-test-ingrediente-${Date.now()}`

    const r1 = await fetch(`${API_URL}/ingredients/auto-create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_USER_TOKEN}`,
      },
      body: JSON.stringify({ name: uniqueName }),
    })
    expect(r1.status).toBe(201)
    const body1 = await r1.json()
    expect(body1.ingredient).toBeTruthy()
    expect(body1.ingredient.name).toBe(uniqueName)
    expect(typeof body1.ingredient.id).toBe('string')

    // Re-run: should dedupe via fuzzy match (exact, in this case).
    const r2 = await fetch(`${API_URL}/ingredients/auto-create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_USER_TOKEN}`,
      },
      body: JSON.stringify({ name: uniqueName }),
    })
    expect(r2.ok).toBe(true)
    const body2 = await r2.json()
    expect(body2.ingredient.id).toBe(body1.ingredient.id)
    expect(body2.dedupedFrom).toBe(uniqueName)
  })

  it.skipIf(!reachable)('GET /ingredients/suggest returns candidates for "alcaparras"', async () => {
    const r = await fetch(
      `${API_URL}/ingredients/suggest?name=alcaparras`,
      {
        headers: { Authorization: `Bearer ${TEST_USER_TOKEN}` },
      },
    )
    if (!r.ok) {
      // USDA may be down or rate-limited; skip rather than fail.
      return
    }
    const body = await r.json()
    expect(body.normalizedName).toBe('alcaparras')
    expect(Array.isArray(body.candidates)).toBe(true)
    expect(typeof body.suggestedAisle).toBe('string')
    expect(Array.isArray(body.suggestedAllergens)).toBe(true)
  })
})
