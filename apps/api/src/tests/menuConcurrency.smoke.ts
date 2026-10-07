/**
 * Smoke: two menu generations at once for the same user both succeed.
 * nutrientBalance.updateBalance used to SELECT then INSERT, so the second
 * request hit the unique user_id and answered 500 (found by the CI agent,
 * 2026-10-07). Registers its own user; only needs a reachable API.
 */
import { describe, it, expect } from 'vitest'
import { API_URL, reachable } from './smokeEnv.js'

describe('menu generation concurrency (smoke)', () => {
  it.skipIf(!reachable)(
    'parallel POST /menu/generate for one user → both 201',
    async () => {
      const name = `conc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const reg = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, email: `${name}@test.local`, password: 'e2epass123' }),
      }).then((r) => r.json())
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${reg.token}` }
      const monday = new Date()
      monday.setDate(monday.getDate() - 35 - monday.getDay() + 1)
      const weekStart = monday.toISOString().slice(0, 10)
      const generate = () =>
        fetch(`${API_URL}/menu/generate`, { method: 'POST', headers, body: JSON.stringify({ userId: reg.user.id, weekStart }) })
      const [a, b] = await Promise.all([generate(), generate()])
      expect([a.status, b.status]).toEqual([201, 201])
    },
    120_000,
  )
})
