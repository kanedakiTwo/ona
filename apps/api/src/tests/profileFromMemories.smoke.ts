/**
 * Smoke (real API + Postgres) for PRO-150 (specs/household-profile.md): the
 * boot-time copy of `user_memories` into the ficha del hogar is idempotent,
 * keeps origins, leaves a history row per fact, and withdrawing the health
 * consent also deletes the ficha's health facts.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/profileFromMemories.smoke.ts
 *
 * Registers its own users (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { profileChanges, profileFacts, userMemories, users } from '../db/schema.js'
import { applyProfileFromMemories } from '../services/profileFromMemories.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

describe.skipIf(!reachable)('user_memories → ficha del hogar (PRO-150)', () => {
  it('copies every memory once, with its origin and history, and consent withdrawal reaches it', async () => {
    const u = `ficha_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const token = reg.body.token as string

    expect((await call('POST', `/user/${userId}/health-consent`, { consent: true }, token)).status).toBe(200)
    expect((await call('PATCH', '/memory', { facts: [
      { key: 'dislikes', value: ['cilantro'] },
      { key: 'equipment', value: ['horno'] },
      { key: 'restrictions', value: ['sin gluten'] },
    ] }, token)).status).toBe(200)
    // What Mimo deduced in a conversation.
    await db.update(userMemories).set({ source: 'inferred', confidence: 0.8 })
      .where(and(eq(userMemories.userId, userId), eq(userMemories.key, 'dislikes')))

    const [user] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId))
    expect(user.householdId).toBeTruthy()

    await applyProfileFromMemories(db, () => {})
    const second = await applyProfileFromMemories(db, () => {})
    expect(second.copied).toBe(0)

    const memIds = (await db.select({ id: userMemories.id }).from(userMemories).where(eq(userMemories.userId, userId))).map((m) => m.id)
    expect(memIds).toHaveLength(3)
    const facts = await db.select().from(profileFacts).where(inArray(profileFacts.sourceMemoryId, memIds))
    expect(facts).toHaveLength(3)
    const byType = Object.fromEntries(facts.map((f) => [f.type, f]))
    expect(byType.dislikes).toMatchObject({ householdId: user.householdId, subjectUserId: userId, origin: 'ai_realtime', status: 'active', value: ['cilantro'] })
    expect(byType.dislikes.confidence).toBeCloseTo(0.8)
    expect(byType.equipment).toMatchObject({ subjectUserId: null, origin: 'user', value: ['horno'] })
    expect(byType.restrictions).toMatchObject({ subjectUserId: userId, origin: 'user' })
    expect((byType.dislikes.evidence as any[])[0]).toMatchObject({ signal: 'user_memories' })

    const changes = await db.select().from(profileChanges).where(inArray(profileChanges.factId, facts.map((f) => f.id)))
    expect(changes).toHaveLength(3)
    expect(changes.every((c) => c.action === 'fact_added')).toBe(true)

    // Withdrawing the consent deletes the health fact (and its history) from the ficha too.
    expect((await call('POST', `/user/${userId}/health-consent`, { consent: false }, token)).status).toBe(200)
    const left = await db.select({ type: profileFacts.type }).from(profileFacts).where(inArray(profileFacts.id, facts.map((f) => f.id)))
    expect(left.map((f) => f.type).sort()).toEqual(['dislikes', 'equipment'])
    const leftChanges = await db.select({ id: profileChanges.id }).from(profileChanges).where(eq(profileChanges.factId, byType.restrictions.id))
    expect(leftChanges).toHaveLength(0)

    // Deleting the account takes the person's facts with it (cascade).
    await db.delete(users).where(eq(users.id, userId))
    const gone = await db.select({ id: profileFacts.id }).from(profileFacts).where(eq(profileFacts.subjectUserId, userId))
    expect(gone).toHaveLength(0)
  }, 30_000)
})
