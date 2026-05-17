import { describe, it, expect } from 'vitest'

const API = process.env.API_URL ?? 'http://localhost:8765'
const TOKEN = process.env.SMOKE_USER_TOKEN

describe('POST /units/resolve', () => {
  it.skipIf(!TOKEN)('table hit: 1 cda → 15 ml', async () => {
    const r = await fetch(`${API}/units/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ displayQuantity: 1, displayUnit: 'cda' }),
    })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ canonicalQuantity: 15, canonicalUnit: 'ml', source: 'table' })
  })

  it.skipIf(!TOKEN)('table hit with bare synonym: cucharadita → 5 ml', async () => {
    const r = await fetch(`${API}/units/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ displayQuantity: 1, displayUnit: 'cucharadita' }),
    })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ canonicalQuantity: 5, canonicalUnit: 'ml', source: 'table' })
  })

  it.skipIf(!TOKEN)('400 on invalid body (missing displayUnit)', async () => {
    const r = await fetch(`${API}/units/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ displayQuantity: 1 }),
    })
    expect(r.status).toBe(400)
  })

  it.skipIf(!process.env.API_URL)('401 without auth', async () => {
    const r = await fetch(`${API}/units/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayQuantity: 1, displayUnit: 'cda' }),
    })
    expect(r.status).toBe(401)
  })
})
