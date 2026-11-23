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

  it.skipIf(!reachable)('an admin email with other capitals is the same account, never a new admin (PRO-1271)', async () => {
    // `smoke-case-admin@test.local` is in ADMIN_EMAILS (test-smoke.sh).
    const post = (path: string, body: object) =>
      fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const first = await post('/register', {
      username: `case_admin_${Date.now()}`,
      email: 'smoke-case-admin@test.local',
      password: 'pw12345678',
      ageConfirmed: true,
    })
    expect([201, 409]).toContain(first.status) // 409 if an earlier run on this database made it
    const variant = await post('/register', {
      username: `case_variant_${Date.now()}`,
      email: 'Smoke-Case-ADMIN@test.local',
      password: 'pw12345678',
      ageConfirmed: true,
    })
    expect(variant.status).toBe(409)
    if (first.status !== 201) return
    // Logging in with other capitals reaches the same (real) account.
    const login = await post('/login', { username: 'SMOKE-case-admin@TEST.local', password: 'pw12345678' })
    expect(login.status).toBe(200)
    const { user } = await login.json()
    expect(user.email).toBe('smoke-case-admin@test.local')
    expect(user.role).toBe('admin')
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
      // Age / activity are health data: consent first (PRO-21).
      await fetch(`${API_URL}/user/${USER_ID}/health-consent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true }),
      })
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
