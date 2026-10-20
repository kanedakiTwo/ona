/**
 * Smoke (PRO-228): each thing of the despensa has a place. Default
 * «despensa»; `?location=` filters; moving it restarts when it went in;
 * an unknown place is refused.
 * Requires SMOKE_USER_ID + SMOKE_USER_TOKEN (smoke orchestrator provides them).
 */
import { describe, it, expect } from 'vitest'
import { API_URL, TOKEN, USER_ID, authHeaders as auth, reachable } from './smokeEnv.js'

const ready = reachable && !!TOKEN && !!USER_ID

describe('pantry by place (smoke)', () => {
  it.skipIf(!ready)('adds with a place, filters by it and moves between places', async () => {
    const add = async (body: Record<string, unknown>) => {
      const r = await fetch(`${API_URL}/pantry`, { method: 'POST', headers: auth(), body: JSON.stringify(body) })
      expect(r.status).toBe(201)
      return r.json()
    }
    const plain = await add({ name: 'Smoke arroz PRO-228' })
    expect(plain.location).toBe('despensa')
    expect(typeof plain.storedAt).toBe('string')
    const frozen = await add({ name: 'Smoke merluza PRO-228', location: 'congelador' })
    expect(frozen.location).toBe('congelador')

    const only = await (await fetch(`${API_URL}/pantry?location=congelador`, { headers: auth() })).json()
    expect(only.map((r: any) => r.id)).toContain(frozen.id)
    expect(only.every((r: any) => r.location === 'congelador')).toBe(true)
    expect(only.map((r: any) => r.id)).not.toContain(plain.id)

    expect((await fetch(`${API_URL}/pantry?location=garaje`, { headers: auth() })).status).toBe(400)
    expect((await fetch(`${API_URL}/pantry`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'x', location: 'garaje' }) })).status).toBe(400)

    // Back-dated, then «Congelador» again keeps the date; a real move restarts it.
    const dated = await (await fetch(`${API_URL}/pantry/${frozen.id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ storedAt: '2026-01-05' }) })).json()
    expect(dated.storedAt.slice(0, 10)).toBe('2026-01-05')
    const same = await (await fetch(`${API_URL}/pantry/${frozen.id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ location: 'congelador' }) })).json()
    expect(same.storedAt.slice(0, 10)).toBe('2026-01-05')
    const moved = await (await fetch(`${API_URL}/pantry/${frozen.id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ location: 'nevera' }) })).json()
    expect(moved.location).toBe('nevera')
    expect(Date.parse(moved.storedAt)).toBeGreaterThan(Date.parse('2026-02-01'))

    for (const id of [plain.id, frozen.id]) await fetch(`${API_URL}/pantry/${id}`, { method: 'DELETE', headers: auth() })
  }, 30_000)
})
