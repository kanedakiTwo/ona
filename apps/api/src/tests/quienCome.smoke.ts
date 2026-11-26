/**
 * PRO-1203 · «Quién come» against a running API + Postgres.
 *
 *  - Seguridad: the restrictions the menu reads are the same before and after
 *    the change for a house with allergies put by the two paths of today
 *    («Alergias e intolerancias» and the old «Preferencias» card, both
 *    `PUT /user/:id`, plus the settings blob the card also wrote) and by Mimo
 *    (memory); a person without an account only adds theirs.
 *  - The size of the house: a house with only the old counter keeps it (rows
 *    nobody describes yet); adding and removing people moves it.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/quienCome.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { userMemories, users } from '../db/schema.js'
import { loadHouseholdRestrictions, unionMemberRestrictions } from '../services/householdAllergies.js'
import { loadMenuRestrictions } from '../services/menuSlotPick.js'

interface Session { auth: Record<string, string>; userId: string; username: string }

async function call(s: Session | null, method: string, path: string, payload?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(s?.auth ?? {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function freshUser(prefix: string, onboarding: Record<string, unknown> | null): Promise<Session> {
  const username = `${prefix}_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call(null, 'POST', '/register', { username, email: `${username}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const s = { auth: { Authorization: `Bearer ${reg.body.token}` }, userId: reg.body.user.id as string, username }
  if (onboarding) expect((await call(s, 'POST', `/user/${s.userId}/onboarding`, onboarding)).status).toBe(200)
  return s
}

const onboarding = (adults: number, kidsCount: number) => ({ adults, kidsCount, cookingFreq: 'daily', restrictions: [], priority: 'varied' })

/** What the menu read before PRO-1203: every member's account + memory restrictions. */
async function membersRestrictionsAsBefore(ids: string[]): Promise<string[]> {
  const [rows, memories] = await Promise.all([
    db.select({ id: users.id, restrictions: users.restrictions }).from(users).where(inArray(users.id, ids)),
    db.select().from(userMemories).where(inArray(userMemories.userId, ids)),
  ])
  return unionMemberRestrictions(ids.map((id) => ({
    restrictions: rows.find((r) => r.id === id)?.restrictions ?? [],
    memoryRestrictions: memories.find((m) => m.userId === id && m.key === 'restrictions')?.value,
  })))
}

describe.skipIf(!reachable)('«Quién come» (smoke)', () => {
  it('the menu reads the same allergies from both paths of today, and a person without an account adds theirs', async () => {
    const owner = await freshUser('quien', onboarding(2, 1))
    const partner = await freshUser('pareja', null)
    const inv = await call(owner, 'POST', '/households/me/invites', { role: 'member' })
    expect((await call(partner, 'POST', `/invites/${inv.body.token}/accept`)).status).toBe(200)

    // Path 1, «Alergias e intolerancias»: consent + the account.
    expect((await call(partner, 'POST', `/user/${partner.userId}/health-consent`, { consent: true })).status).toBe(200)
    expect((await call(partner, 'PUT', `/user/${partner.userId}`, { restrictions: ['marisco'] })).status).toBe(200)
    // Path 2, the old «Preferencias» card: the account and the settings blob.
    expect((await call(owner, 'POST', `/user/${owner.userId}/health-consent`, { consent: true })).status).toBe(200)
    expect((await call(owner, 'PUT', `/user/${owner.userId}`, { restrictions: ['sin gluten', 'vegetariano'] })).status).toBe(200)
    expect((await call(owner, 'PUT', `/user/${owner.userId}/settings`, { template: { preferences: { restrictions: ['sin gluten', 'vegetariano'], priority: 'balanced' } } })).status).toBe(200)
    // And Mimo's memory.
    expect((await call(owner, 'PATCH', '/memory', { facts: [{ key: 'restrictions', value: ['pimiento'] }] })).status).toBe(200)

    const before = await membersRestrictionsAsBefore([owner.userId, partner.userId])
    expect(before).toEqual(expect.arrayContaining(['sin gluten', 'vegetariano', 'pimiento', 'marisco']))
    expect([...(await loadHouseholdRestrictions(owner.userId))].sort()).toEqual([...before].sort())
    expect([...(await loadHouseholdRestrictions(partner.userId))].sort()).toEqual([...before].sort())
    // The generator's own entry point (every one-dish path and the review use it).
    const menu = await loadMenuRestrictions({ userId: owner.userId })
    expect([...menu.restrictions].sort()).toEqual([...before].sort())

    // «Quién come»: the reader's own allergies are what the menu reads for them; the partner's are theirs.
    const people = (await call(owner, 'GET', '/households/me/people')).body
    const me = people.people.find((p: any) => p.kind === 'me')
    expect([...me.restrictions].sort()).toEqual(['pimiento', 'sin gluten', 'vegetariano'])
    expect(people.people.find((p: any) => p.kind === 'member')).toMatchObject({ name: partner.username, restrictions: null, answered: true })

    // A child without an account with «frutos secos»: added to what the menu reads, nothing taken away.
    const child = await call(owner, 'POST', '/household/profile/persons', { alias: 'la pequeña', ageBand: '3-5' })
    expect(child.status).toBe(201)
    const saved = await call(owner, 'PUT', `/households/me/people/${child.body.id}/restrictions`, { values: ['Frutos secos'] })
    expect(saved.body).toEqual({ values: ['frutos secos'] })
    const after = await loadHouseholdRestrictions(partner.userId)
    expect([...after].sort()).toEqual([...before, 'frutos secos'].sort())
    const row = (await call(owner, 'GET', '/households/me/people')).body.people.find((p: any) => p.id === child.body.id)
    expect(row).toMatchObject({ kind: 'person', name: 'la pequeña', group: 'kid', restrictions: ['frutos secos'] })

    // Emptying the list takes it away again.
    await call(owner, 'PUT', `/households/me/people/${child.body.id}/restrictions`, { values: [] })
    expect([...(await loadHouseholdRestrictions(owner.userId))].sort()).toEqual([...before].sort())
  })

  it('allergies of a person need the writer’s health consent', async () => {
    const owner = await freshUser('sincons', onboarding(1, 0))
    const p = await call(owner, 'POST', '/household/profile/persons', { alias: 'la abuela', ageBand: 'adulto' })
    const r = await call(owner, 'PUT', `/households/me/people/${p.body.id}/restrictions`, { values: ['marisco'] })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('HEALTH_CONSENT_REQUIRED')
    // Dislikes aren't health data.
    expect((await call(owner, 'PUT', `/households/me/people/${p.body.id}/dislikes`, { values: ['cilantro'] })).body).toEqual({ values: ['cilantro'] })
  })

  it('the size of the house: the old counter stays until the people change, then follows them', async () => {
    const owner = await freshUser('tamano', onboarding(2, 1))
    const counts = async () => {
      const [u] = await db.select({ adults: users.adults, kidsCount: users.kidsCount }).from(users).where(eq(users.id, owner.userId))
      return u
    }
    let view = (await call(owner, 'GET', '/households/me/people')).body
    expect(view.counts).toEqual({ adults: 2, kidsCount: 1 })
    expect(view.people.map((p: any) => p.id)).toEqual(['me', 'extra-adult-1', 'extra-kid-1'])
    expect(await counts()).toEqual({ adults: 2, kidsCount: 1 }) // reading changes nothing

    // Describing the child the counter had: same size, no undescribed child left.
    const kid = (await call(owner, 'POST', '/household/profile/persons', { alias: 'el pequeño', ageBand: '6-12' })).body
    view = (await call(owner, 'GET', '/households/me/people')).body
    expect(view.counts).toEqual({ adults: 2, kidsCount: 1 })
    expect(view.people.map((p: any) => p.kind)).toEqual(['me', 'person', 'extra'])

    // A baby doesn't count; a teenager is one more adult.
    await call(owner, 'POST', '/household/profile/persons', { alias: 'el bebé', ageBand: '0-2' })
    const teen = (await call(owner, 'POST', '/household/profile/persons', { alias: 'la mayor', ageBand: '13-17' })).body
    expect(await counts()).toEqual({ adults: 2, kidsCount: 1 })
    await call(owner, 'POST', '/household/profile/persons', { alias: 'la abuela', ageBand: 'adulto' })
    expect(await counts()).toEqual({ adults: 3, kidsCount: 1 })
    // Mimo's memory copy follows when there is one.
    expect((await call(owner, 'GET', `/user/${owner.userId}`)).body).toMatchObject({ adults: 3, kidsCount: 1 })

    // Removing people lowers it.
    expect((await call(owner, 'DELETE', `/household/profile/persons/${teen.id}`)).status).toBe(204)
    expect(await counts()).toEqual({ adults: 2, kidsCount: 1 })
    expect((await call(owner, 'DELETE', `/household/profile/persons/${kid.id}`)).status).toBe(204)
    expect(await counts()).toEqual({ adults: 2, kidsCount: 0 })

    // Nobody undescribed left: «No está» has nothing to remove.
    expect((await call(owner, 'POST', '/households/me/people/undescribed/remove', { group: 'adult' })).status).toBe(404)
  })

  it('«No está» on an undescribed row lowers the counter', async () => {
    const owner = await freshUser('noesta', onboarding(3, 2))
    const r = await call(owner, 'POST', '/households/me/people/undescribed/remove', { group: 'kid' })
    expect(r.body).toEqual({ adults: 3, kidsCount: 1 })
    const view = (await call(owner, 'GET', '/households/me/people')).body
    expect(view.people.filter((p: any) => p.kind === 'extra').map((p: any) => p.group)).toEqual(['adult', 'adult', 'kid'])
  })
})
