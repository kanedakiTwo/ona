/**
 * Smoke (real API + Postgres) for PRO-258 (specs/smart-menu.md → «La semana
 * se piensa el sábado por la noche»): one Saturday end to end against the
 * database with the Message Batches API simulated — the week is claimed
 * once, the household's next week is prepared from the real generator and
 * catalogue, and collecting the batch stores the checked plan.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/menuPlannerWeekly.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { menuPlannerRunItems, menuPlannerRuns, users } from '../db/schema.js'
import { madridWeekStart } from '../services/madridTime.js'
import { collectWeeklyPlans, defaultWeeklyDeps, submitWeeklyPlans } from '../services/menuPlannerWeekly.js'
import type { BatchResultLike } from '../services/profile/refiner.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

describe.skipIf(!reachable)('la semana se piensa el sábado por la noche (PRO-258)', () => {
  it('prepares next week from the real generator, sends it once and stores the checked plan', async () => {
    const u = `sabado_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const token = reg.body.token as string
    expect((await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount: 0, cookingFreq: '3_4_times', favoriteDishes: ['lentejas'], priority: 'varied', restrictions: [] }, token)).status).toBe(200)
    const thisWeek = madridWeekStart(new Date())
    expect((await call('POST', '/menu/generate', { userId, weekStart: thisWeek }, token)).status).toBe(201)
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    const householdId = user.primaryHouseholdId!

    // A week far in the future so the smoke DB never has a run for it.
    const weekStart = `2099-0${1 + Math.floor(Math.random() * 9)}-0${1 + Math.floor(Math.random() * 7)}`
    await db.delete(menuPlannerRuns).where(eq(menuPlannerRuns.weekStart, weekStart))
    const sent: any[] = []
    const base = defaultWeeklyDeps(db)
    const deps = {
      ...base,
      listCandidates: async () => [{ householdId, ownerId: userId, ownerSuspended: false, subscriptionStatus: 'active' }],
      capExceeded: async () => false,
      isActive: async () => true,
      batch: {
        async create(reqs: any[]) { sent.push(...reqs); return { id: `fake-${weekStart}` } },
        async status() { return 'ended' as const },
        async results() {
          return (async function* () {
            for (const r of sent) {
              const prompt = r.params.messages[0].content as string
              const refs = [...prompt.matchAll(/^(C\d+) · /gm)].map((m) => m[1])
              const slots = [...prompt.matchAll(/^- día (\d) \([^)]+\) · (lunch|dinner)/gm)].map((m, i) => ({ day: Number(m[1]), meal: m[2], ref: refs[i % refs.length], why: 'porque sí', leftoverOfDay: -1, leftoverOfMeal: '' }))
              const result: BatchResultLike['result'] = { type: 'succeeded', message: { stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 3000 }, content: [{ type: 'text', text: JSON.stringify({ slots }) }] } }
              yield { custom_id: r.custom_id, result }
            }
          })()
        },
      },
    }
    const now = new Date()
    const submitted = await submitWeeklyPlans(weekStart, now, deps)
    expect(submitted.status).toBe('submitted')
    expect(sent).toHaveLength(1)
    expect((await submitWeeklyPlans(weekStart, now, deps)).status).toBe('already')

    expect(await collectWeeklyPlans(now, deps)).toBeGreaterThanOrEqual(1)
    const [run] = await db.select().from(menuPlannerRuns).where(eq(menuPlannerRuns.weekStart, weekStart))
    expect(run.status).toBe('ended')
    const [item] = await db.select().from(menuPlannerRunItems).where(eq(menuPlannerRunItems.runId, run.id))
    expect(['ok', 'partial']).toContain(item.status)
    expect(item.days).toBeTruthy()
    expect(item.costMicros).toBeGreaterThan(0)
  }, 60_000)
})
