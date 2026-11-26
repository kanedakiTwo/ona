/**
 * Smoke test for the /ingredients/auto-create route.
 *
 * Skips when the API isn't reachable on $API_URL (default :8000) or when
 * SMOKE_USER_TOKEN is absent — see smokeEnv.ts; under SMOKE_REQUIRED=true
 * (CI) either is a hard failure instead.
 *
 * Covers:
 *   - POST /ingredients/auto-create with a brand-new name persists a row
 *   - Re-running the same name fuzzy-dedupes back to the same row
 *
 * Run: pnpm --filter @ona/api test
 */

import { describe, it, expect } from 'vitest'
import { API_URL, TOKEN as TEST_USER_TOKEN, reachable } from './smokeEnv.js'

describe('ingredients/auto-create smoke', () => {
  it.skipIf(!reachable || !TEST_USER_TOKEN)('POST /ingredients/auto-create persists a stub row + dedupes on re-run', async () => {
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

  it.skipIf(!reachable || !TEST_USER_TOKEN)('GET /ingredients/suggest returns candidates for "alcaparras"', async () => {
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

  // 2026-11-10: "Tomate" found nothing in /recipes/new (case-sensitive LIKE against "tomate"). The search folds case
  // and accents and puts the exact name first.
  it.skipIf(!reachable || !TEST_USER_TOKEN)('GET /ingredients?search= ignores case and accents, exact name first', async () => {
    const stamp = Date.now()
    const name = `smoke brócoli ${stamp}`
    const created = await fetch(`${API_URL}/ingredients/auto-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_USER_TOKEN}` },
      body: JSON.stringify({ name }),
    })
    expect(created.ok).toBe(true)
    const { ingredient } = await created.json()
    // a longer name that also matches, to check the exact one comes first
    await fetch(`${API_URL}/ingredients/auto-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_USER_TOKEN}` },
      body: JSON.stringify({ name: `aaa ${name} con ajo` }),
    })

    for (const typed of [`Smoke Brocoli ${stamp}`, `SMOKE BRÓCOLI ${stamp}`, `smoke  brocoli ${stamp}`]) {
      const r = await fetch(`${API_URL}/ingredients?search=${encodeURIComponent(typed)}&perPage=20`)
      expect(r.ok).toBe(true)
      const rows: Array<{ id: string; name: string }> = await r.json()
      expect(rows.map((x) => x.id)).toContain(ingredient.id)
      expect(rows[0].id).toBe(ingredient.id)
    }
  })
})
