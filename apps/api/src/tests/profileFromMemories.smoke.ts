/**
 * Smoke (real API + Postgres) for PRO-150 and PRO-316 (specs/household-profile.md):
 * every memory write lands in the ficha at once (same transaction, with its
 * history row and where it was said); the boot-time copy is idempotent and
 * puts back in step a copy whose memory changed behind its back; forgetting
 * retires the fact; withdrawing the health consent deletes the ficha's health
 * facts; deleting the account takes the person's facts with it.
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
import { setMemoryBatch } from '../services/userMemoryStore.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

describe.skipIf(!reachable)('user_memories → ficha del hogar (PRO-150, PRO-316)', () => {
  it('every memory write is in the ficha at once; the boot copy only catches up; forget and consent reach it', async () => {
    const u = `ficha_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const token = reg.body.token as string
    const [user] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId))
    expect(user.householdId).toBeTruthy()

    expect((await call('POST', `/user/${userId}/health-consent`, { consent: true }, token)).status).toBe(200)
    expect((await call('PATCH', '/memory', { facts: [
      { key: 'dislikes', value: ['cilantro'] },
      { key: 'equipment', value: ['horno'] },
      { key: 'restrictions', value: ['sin gluten'] },
    ] }, token)).status).toBe(200)

    // In the ficha already, no boot needed: about the person or the household, origin user, said in Perfil.
    const memIds = (await db.select({ id: userMemories.id }).from(userMemories).where(eq(userMemories.userId, userId))).map((m) => m.id)
    expect(memIds).toHaveLength(3)
    const facts = await db.select().from(profileFacts).where(inArray(profileFacts.sourceMemoryId, memIds))
    expect(facts).toHaveLength(3)
    const byType = Object.fromEntries(facts.map((f) => [f.type, f]))
    expect(byType.dislikes).toMatchObject({ householdId: user.householdId, subjectUserId: userId, origin: 'user', status: 'active', value: ['cilantro'] })
    expect(byType.equipment).toMatchObject({ subjectUserId: null, origin: 'user', value: ['horno'] })
    expect(byType.restrictions).toMatchObject({ subjectUserId: userId, origin: 'user' })
    expect((byType.dislikes.evidence as any[])[0]).toMatchObject({ signal: 'profile', summary: 'Lo escribiste en Perfil: No le gusta: cilantro' })
    const added = await db.select().from(profileChanges).where(inArray(profileChanges.factId, facts.map((f) => f.id)))
    expect(added.map((c) => c.action)).toEqual(['fact_added', 'fact_added', 'fact_added'])

    // What Mimo deduced on WhatsApp updates the same fact, with its history row.
    await setMemoryBatch(userId, [{ key: 'dislikes', value: ['cilantro', 'hígado'], confidence: 0.8 }], 'inferred', { signal: 'whatsapp' })
    const [dislikes] = await db.select().from(profileFacts).where(eq(profileFacts.id, byType.dislikes.id))
    expect(dislikes).toMatchObject({ origin: 'ai_realtime', value: ['cilantro', 'hígado'] })
    expect(dislikes.confidence).toBeCloseTo(0.8)
    expect((dislikes.evidence as any[]).at(-1)).toMatchObject({ signal: 'whatsapp' })

    // The boot copy has nothing to copy for this user (the smoke DB is shared: count only ours)…
    await applyProfileFromMemories(db, () => {})
    expect(await db.select({ id: profileFacts.id }).from(profileFacts).where(inArray(profileFacts.sourceMemoryId, memIds))).toHaveLength(3)
    // …but puts back in step a copy whose memory changed behind its back (a write from before PRO-316).
    await db.update(userMemories).set({ value: ['ajo'], updatedAt: new Date(Date.now() + 60_000) })
      .where(and(eq(userMemories.userId, userId), eq(userMemories.key, 'dislikes')))
    expect((await applyProfileFromMemories(db, () => {})).refreshed).toBeGreaterThanOrEqual(1)
    expect((await db.select({ value: profileFacts.value }).from(profileFacts).where(eq(profileFacts.id, byType.dislikes.id)))[0].value).toEqual(['ajo'])
    const again = await applyProfileFromMemories(db, () => {})
    expect(again.copied).toBe(0)

    // Forgetting in Perfil retires the fact, with its history row.
    expect((await call('DELETE', '/memory/dislikes', undefined, token)).status).toBe(204)
    const [retired] = await db.select({ status: profileFacts.status }).from(profileFacts).where(eq(profileFacts.id, byType.dislikes.id))
    expect(retired.status).toBe('retired')
    const history = await db.select({ action: profileChanges.action }).from(profileChanges).where(eq(profileChanges.factId, byType.dislikes.id))
    expect(history.map((h) => h.action)).toContain('fact_retired')

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
