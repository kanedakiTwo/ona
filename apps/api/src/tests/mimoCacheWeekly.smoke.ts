/**
 * Smoke (real Postgres, and the API for the route) for PRO-1291: Mimo's turns
 * in `cost_events` come back in `/admin/usage` as `mimoCache`, the cache
 * tokens written and read per turn by week.
 *
 *   API_URL=… DATABASE_URL=… METRICS_READ_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/mimoCacheWeekly.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { costEvents } from '../db/schema.js'
import { loadMimoCacheWeekly } from '../services/mimoTurnCost.js'

const tag = `cache${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const METRICS_TOKEN = process.env.METRICS_READ_TOKEN ?? ''

describe.skipIf(!reachable)('mimoCache in /admin/usage (PRO-1291)', () => {
  it('reads Mimo’s turns of a week from cost_events', async () => {
    const reg = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: tag, email: `${tag}@test.local`, password: 'e2epass123', ageConfirmed: true }),
    })
    expect(reg.status).toBe(201)
    const userId = (await reg.json()).user.id as string
    // A week of 2020 nobody else writes in: one turn after a pause and one 2 minutes later.
    const row = (at: string, write: number, read: number) => ({ userId, feature: 'whatsapp_chat', provider: 'anthropic', model: 'smoke', units: { cacheWriteTokens: write, cacheReadTokens: read }, costMicros: 0, createdAt: new Date(at) })
    await db.insert(costEvents).values([row('2020-03-03T10:00:00Z', 50_000, 0), row('2020-03-03T10:02:00Z', 4_000, 50_000)])
    try {
      const weeks = await loadMimoCacheWeekly(7, new Date('2020-03-06T12:00:00Z'))
      expect(weeks.find((w) => w.week === '2020-03-02' && w.feature === 'whatsapp_chat')).toEqual({
        week: '2020-03-02',
        feature: 'whatsapp_chat',
        turns: 2,
        cacheWritePerTurn: 27_000,
        cacheReadPerTurn: 25_000,
        followUpTurns: 1,
        followUpCacheWritePerTurn: 4_000,
      })
    } finally {
      await db.delete(costEvents).where(eq(costEvents.userId, userId))
    }
  })

  it.skipIf(!METRICS_TOKEN)('comes back in the route', async () => {
    const r = await fetch(`${API_URL}/admin/usage?days=7`, { headers: { 'x-metrics-token': METRICS_TOKEN } })
    expect(r.status).toBe(200)
    expect(Array.isArray((await r.json()).mimoCache)).toBe(true)
  })
})
