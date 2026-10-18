/**
 * Smoke for `GET /public/config` (PRO-167) against a running API: public (no
 * token) and it says the API's registration mode. CI's smoke job runs with
 * REGISTRATION_MODE=open. Skips when the API isn't reachable.
 */
import { describe, expect, it } from 'vitest'
import { API_URL, reachable } from './smokeEnv.js'

describe.skipIf(!reachable)('GET /public/config (real API)', () => {
  it('answers without auth with the registration mode', async () => {
    const r = await fetch(`${API_URL}/public/config`)
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(['invite', 'open']).toContain(body.registration)
    if (process.env.REGISTRATION_MODE) expect(body.registration).toBe(process.env.REGISTRATION_MODE)
  })
})
