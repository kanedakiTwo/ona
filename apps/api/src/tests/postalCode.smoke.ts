/**
 * PRO-1124 (D-179) against a running API + Postgres: the household's postal
 * code.
 *   - «Hazme la compra» (`POST /shop-orders/prepare`) asks it once: the next
 *     time, `askPostalCode` is false, answered or not;
 *   - «Ahora no» (`POST /households/me/postal-code/skip`): it doesn't come back;
 *   - Perfil → Tu casa (`PUT /households/me/postal-code`): saved, changed,
 *     deleted; a code that isn't Spanish → 400; a child → 403;
 *   - `/admin/metrics` → `postalDemand` (`loadPostalDemand`): no postal code ×
 *     kind under 3 households (D-094, LEG-506).
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/postalCode.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { households, users } from '../db/schema.js'
import { loadPostalDemand } from '../services/postalCode.js'

const tag = `cp${Date.now()}${Math.random().toString(36).slice(2, 6)}`

interface Session { id: string; token: string }

async function call(method: string, path: string, s?: Session, payload?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

let n = 0
async function register(): Promise<Session> {
  const u = `${tag}${n++}`
  const reg = await call('POST', '/register', undefined, { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
  expect(reg.status, JSON.stringify(reg.body)).toBe(201)
  return { id: reg.body.user.id as string, token: reg.body.token as string }
}

const addShop = (s: Session) =>
  call('POST', '/shops', s, { name: 'Frutería del barrio', kind: 'fruteria', channel: 'whatsapp', whatsapp: '34600000001', fulfilment: 'recoger' })
const prepare = (s: Session) => call('POST', '/shop-orders/prepare', s, {})

async function householdOf(userId: string): Promise<string> {
  const [u] = await db.select({ h: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
  return u!.h!
}

describe.skipIf(!reachable)('postal code of a household (PRO-1124)', () => {
  it('«Hazme la compra» asks it once; the second time, no', async () => {
    const me = await register()
    expect((await addShop(me)).status).toBe(201)
    const first = await prepare(me)
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.askPostalCode).toBe(true)
    // Not answered, not skipped: it still doesn't come back by itself.
    const second = await prepare(me)
    expect(second.body.askPostalCode).toBe(false)
    expect((await call('GET', '/households/me/postal-code', me)).body).toEqual({ postalCode: null, asked: true })
  }, 60_000)

  it('without shops there is no «Hazme la compra» yet: not asked, not spent', async () => {
    const me = await register()
    const r = await prepare(me)
    expect(r.body.hasShops).toBe(false)
    expect(r.body.askPostalCode).toBe(false)
    expect((await call('GET', '/households/me/postal-code', me)).body.asked).toBe(false)
  }, 60_000)

  it('«Ahora no»: skipped, and the question never comes', async () => {
    const me = await register()
    expect((await call('POST', '/households/me/postal-code/skip', me)).status).toBe(204)
    await addShop(me)
    expect((await prepare(me)).body.askPostalCode).toBe(false)
    expect((await call('GET', '/households/me/postal-code', me)).body).toEqual({ postalCode: null, asked: true })
  }, 60_000)

  it('Perfil: saved, changed and deleted; a code that is not Spanish → 400', async () => {
    const me = await register()
    const saved = await call('PUT', '/households/me/postal-code', me, { postalCode: '28 012' })
    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({ postalCode: '28012', asked: true })
    expect((await call('PUT', '/households/me/postal-code', me, { postalCode: '41001' })).body.postalCode).toBe('41001')
    const bad = await call('PUT', '/households/me/postal-code', me, { postalCode: 'calle Mayor 3' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/5 cifras/)
    expect((await call('GET', '/households/me/postal-code', me)).body.postalCode).toBe('41001')
    // With one already saved, «Hazme la compra» doesn't ask.
    await addShop(me)
    expect((await prepare(me)).body.askPostalCode).toBe(false)
    const cleared = await call('PUT', '/households/me/postal-code', me, { postalCode: '' })
    expect(cleared.body).toEqual({ postalCode: null, asked: true })
    // Deleted in Perfil: still not asked again.
    expect((await prepare(me)).body.askPostalCode).toBe(false)
  }, 60_000)

  it('a child of the house can’t change it (403); the adults share it', async () => {
    const owner = await register()
    const invite = await call('POST', '/households/me/invites', owner, { role: 'child' })
    expect(invite.status, JSON.stringify(invite.body)).toBe(201)
    const kid = await register()
    expect((await call('POST', `/invites/${invite.body.token}/accept`, kid)).status).toBe(200)
    expect((await call('PUT', '/households/me/postal-code', kid, { postalCode: '28012' })).status).toBe(403)
    await call('PUT', '/households/me/postal-code', owner, { postalCode: '28012' })
    expect((await call('GET', '/households/me/postal-code', kid)).body.postalCode).toBe('28012')
  }, 60_000)

  it('postalDemand: postal code × kind only from 3 households', async () => {
    // Two codes no other test uses: 3 households in one, 2 in the other.
    const big = `52${String(Date.now()).slice(-3)}`
    const small = `51${String(Date.now()).slice(-3)}`
    const people = await Promise.all([register(), register(), register(), register(), register()])
    const ids = await Promise.all(people.map((p) => householdOf(p.id)))
    await db.update(households).set({ postalCode: big }).where(inArray(households.id, ids.slice(0, 3)))
    await db.update(households).set({ postalCode: small }).where(inArray(households.id, ids.slice(3)))
    // One of the three has its own frutería: 2 left waiting one there.
    await addShop(people[0]!)

    const d = await loadPostalDemand()
    const at = (code: string) => d.zones.filter((z) => z.postalCode === code)
    expect(at(big).map((z) => [z.kind, z.households]).sort()).toEqual([['carniceria', 3], ['pescaderia', 3]])
    expect(at(small)).toEqual([])
    expect(d.zones.every((z) => z.households >= 3)).toBe(true)
    for (const v of Object.values(d.others)) expect(v === null || v >= 3).toBe(true)
    expect(d.withPostalCode).toBeGreaterThanOrEqual(5)
    expect(d.minGroup).toBe(3)
  }, 120_000)
})
