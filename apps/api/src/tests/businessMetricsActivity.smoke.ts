/**
 * Smoke for PRO-1069 against the real Postgres: who is an active household in
 * GET /admin/metrics (`loadActivity`, the SQL behind `activeHouseholds`). A
 * household whose only cost of the week is the ficha's nightly refiner (or a
 * message Mimo wrote by itself) is not active; one that talked to Mimo is,
 * and so is one that corrected its ficha (billed `ficha` too, but with a
 * `profile_changes` row of origin `user`).
 * Registers its own users (needs REGISTRATION_MODE=open, as CI's smoke job).
 * Skips when the API isn't reachable.
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { costEvents, profileChanges, users } from '../db/schema.js'
import { loadActivity } from '../services/businessMetrics.js'
import { madridMidnightUtc, madridWeekStart } from '../services/madridTime.js'

const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
let n = 0

async function register(): Promise<{ userId: string; householdId: string }> {
  const u = `bma_${id}${++n}`.slice(0, 30)
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true }),
  })
  expect(r.status).toBe(201)
  const { user } = await r.json()
  const [row] = await db.select({ hh: users.primaryHouseholdId }).from(users).where(eq(users.id, user.id))
  expect(row.hh).toBeTruthy()
  return { userId: user.id, householdId: row.hh! }
}

const cost = (userId: string, householdId: string, feature: string) => ({
  userId, householdId, feature, provider: 'anthropic', model: 'claude-opus-5-5', units: { inputTokens: 100 }, costMicros: 10,
})

describe.skipIf(!reachable)('active households: no night jobs (real DB)', () => {
  it('only `ficha` (or Mimo writing by itself) → not active; chatting or correcting the ficha → active', async () => {
    const onlyFicha = await register()
    const onlyGuided = await register()
    const chatted = await register()
    const corrected = await register()

    await db.insert(costEvents).values([
      cost(onlyFicha.userId, onlyFicha.householdId, 'ficha'),
      cost(onlyFicha.userId, onlyFicha.householdId, 'ficha'),
      cost(onlyGuided.userId, onlyGuided.householdId, 'whatsapp_guided'),
      cost(chatted.userId, chatted.householdId, 'ficha'),
      cost(chatted.userId, chatted.householdId, 'assistant_chat'),
      cost(corrected.userId, corrected.householdId, 'ficha'),
    ])
    await db.insert(profileChanges).values({
      householdId: corrected.householdId, action: 'fact_updated', before: null, after: null,
      reason: 'Lo corrigió en su ficha', origin: 'user', actorUserId: corrected.userId,
    })

    const week = madridWeekStart(new Date())
    const activity = await loadActivity(madridMidnightUtc(week), false, db)
    const active = new Set(activity.filter((a) => a.week === week).map((a) => a.householdId))
    expect(active.has(onlyFicha.householdId)).toBe(false)
    expect(active.has(onlyGuided.householdId)).toBe(false)
    expect(active.has(chatted.householdId)).toBe(true)
    expect(active.has(corrected.householdId)).toBe(true)
  })
})
