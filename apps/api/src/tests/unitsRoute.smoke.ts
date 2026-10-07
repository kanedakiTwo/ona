/**
 * Smoke test for POST /units/resolve against a running API. Gating lives in
 * smokeEnv.ts (skips when the API is down; hard-fails under SMOKE_REQUIRED).
 */
import { describe, it, expect } from 'vitest'
import { API_URL as API, TOKEN, reachable } from './smokeEnv.js'

describe('POST /units/resolve', () => {
  it.skipIf(!reachable || !TOKEN)('table hit: 1 cda → 15 ml', async () => {
    const r = await fetch(`${API}/units/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ displayQuantity: 1, displayUnit: 'cda' }),
    })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ canonicalQuantity: 15, canonicalUnit: 'ml', source: 'table' })
  })

  it.skipIf(!reachable || !TOKEN)('table hit with bare synonym: cucharadita → 5 ml', async () => {
    const r = await fetch(`${API}/units/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ displayQuantity: 1, displayUnit: 'cucharadita' }),
    })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ canonicalQuantity: 5, canonicalUnit: 'ml', source: 'table' })
  })

  it.skipIf(!reachable || !TOKEN)('400 on invalid body (missing displayUnit)', async () => {
    const r = await fetch(`${API}/units/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ displayQuantity: 1 }),
    })
    expect(r.status).toBe(400)
  })

  it.skipIf(!reachable)('401 without auth', async () => {
    const r = await fetch(`${API}/units/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayQuantity: 1, displayUnit: 'cda' }),
    })
    expect(r.status).toBe(401)
  })
})
