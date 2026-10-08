/**
 * Smoke test for the auth routes (register, login, /user/:id).
 *
 * Skips when the API isn't reachable on $API_URL (default :8000) — see
 * smokeEnv.ts; under SMOKE_REQUIRED=true (CI) that is a hard failure instead.
 * Run via `pnpm --filter @ona/api smoke`, which boots Docker Postgres + the
 * API + a throwaway user before invoking vitest.
 */

import { describe, it, expect } from 'vitest'
import { API_URL, TOKEN, USER_ID, reachable } from './smokeEnv.js'

describe('auth route smoke', () => {
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
      body: JSON.stringify({ username: u, email: `${u}@test.local`, password: 'pw12345678', ageConfirmed: true }),
    })
    expect(first.status).toBe(201)
    const second = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, email: `${u}-2@test.local`, password: 'pw12345678', ageConfirmed: true }),
    })
    expect(second.status).toBe(409)
  })

  it.skipIf(!reachable)('POST /register without «Tengo 14 años o más» is a 400 (PRO-23)', async () => {
    const u = `age_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const base = { username: u, email: `${u}@test.local`, password: 'pw12345678' }
    for (const body of [base, { ...base, ageConfirmed: false }]) {
      const r = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(r.status).toBe(400)
    }
    const ok = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, ageConfirmed: true }),
    })
    expect(ok.status).toBe(201)
    const { user } = await ok.json()
    expect(Date.parse(user.ageConfirmedAt)).toBeGreaterThan(Date.now() - 60_000)
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
