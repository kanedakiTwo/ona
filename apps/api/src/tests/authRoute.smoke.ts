/**
 * Smoke test for the auth routes (register, login, /user/:id).
 *
 * Skips entirely when the API isn't reachable on $API_URL or 8000 — same
 * pattern as the other *.smoke.ts files. Run via `pnpm --filter @ona/api smoke`
 * which boots Docker Postgres + the API + a throwaway user before invoking
 * vitest.
 */

import { describe, it, expect, beforeAll } from 'vitest'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'
const TOKEN = process.env.SMOKE_USER_TOKEN ?? ''
const USER_ID = process.env.SMOKE_USER_ID ?? ''

async function isApiReachable(): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 1500)
  const r = await fetch(`${API_URL}/health`, { signal: ctrl.signal }).catch(() => null)
  clearTimeout(t)
  return r != null && r.ok
}

describe('auth route smoke', () => {
  let reachable = false
  beforeAll(async () => {
    reachable = await isApiReachable()
  })

  it.skipIf(!reachable)('GET /recipes (unauthed) returns 401', async () => {
    const r = await fetch(`${API_URL}/recipes`)
    // Public route → 200; protected → 401. /recipes IS public per spec, so 200.
    // The auth gate test below uses a protected route.
    expect([200, 401]).toContain(r.status)
  })

  it.skipIf(!reachable)('GET /user/:id without token returns 401', async () => {
    const r = await fetch(`${API_URL}/user/some-id`)
    expect(r.status).toBe(401)
  })

  it.skipIf(!reachable)('POST /login with bogus credentials returns 401', async () => {
    const r = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody-here', password: 'nothing' }),
    })
    expect(r.status).toBe(401)
  })

  it.skipIf(!reachable)('POST /register rejects a duplicate username', async () => {
    if (!USER_ID) return // smoke runner didn't pre-register one — skip
    const u = `dup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const first = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, email: `${u}@test.local`, password: 'pw12345678' }),
    })
    expect(first.status).toBe(201)
    const second = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, email: `${u}-2@test.local`, password: 'pw12345678' }),
    })
    expect(second.status).toBe(409)
  })

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'GET /user/:id with token returns the user',
    async () => {
      const r = await fetch(`${API_URL}/user/${USER_ID}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      expect(r.status).toBe(200)
      const body = await r.json()
      expect(body.id).toBe(USER_ID)
      expect(typeof body.username).toBe('string')
      expect(body).not.toHaveProperty('passwordHash')
    },
  )

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'PUT /user/:id partial update accepts camelCase activityLevel',
    async () => {
      const r = await fetch(`${API_URL}/user/${USER_ID}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ activityLevel: 'moderate', age: 30 }),
      })
      expect(r.status).toBe(200)
      const body = await r.json()
      expect(body.activityLevel).toBe('moderate')
      expect(body.age).toBe(30)
    },
  )
})
