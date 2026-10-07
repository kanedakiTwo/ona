/**
 * Smoke test for the assistant chat route guards.
 *
 * Only covers the paths that return BEFORE any Claude call — the caller-id
 * check (403) and the missing-message check (400) — so the smoke never spends
 * tokens or needs ANTHROPIC_API_KEY. The budget gate + spend metering math is
 * unit-tested in advisorBudget.test.ts.
 *
 * Requires SMOKE_USER_ID + SMOKE_USER_TOKEN (smoke orchestrator provides them).
 */
import { describe, it, expect } from 'vitest'
import { API_URL, TOKEN, USER_ID, authHeaders as auth, reachable } from './smokeEnv.js'

describe('assistant chat route smoke', () => {
  it.skipIf(!reachable)('POST /assistant/:userId/chat without a token returns 401', async () => {
    const r = await fetch(`${API_URL}/assistant/${USER_ID || '00000000-0000-0000-0000-000000000000'}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hola' }),
    })
    expect(r.status).toBe(401)
  })

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'chatting as a DIFFERENT user is forbidden (403, no model call)',
    async () => {
      const other = '11111111-1111-1111-1111-111111111111'
      const r = await fetch(`${API_URL}/assistant/${other}/chat`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ message: 'hola' }),
      })
      expect(r.status).toBe(403)
    },
  )

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'missing message returns 400 (still before any model call)',
    async () => {
      const r = await fetch(`${API_URL}/assistant/${USER_ID}/chat`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({}),
      })
      expect(r.status).toBe(400)
    },
  )
})
