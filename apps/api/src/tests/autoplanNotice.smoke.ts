/**
 * Smoke (real API + Postgres) for PRO-382 (specs/notifications.md «La
 * semana, hecha»): after the Thursday week (PRO-381), the notice is claimed
 * once per household and week, spends its unit in `notice_candidates` and
 * keeps its outcome on the claim row. Without WhatsApp, push or an email key
 * (the smoke environment) no channel gets it out: logged `fallido`, not
 * retried.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/autoplanNotice.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { noticeCandidates, notificationSchedule } from '../db/schema.js'
import { madridWeekStart } from '../services/madridTime.js'
import { resolveScope } from '../services/scopeResolver.js'
import { autoplanKey, defaultAutoplanDeps, runWeeklyAutoplanIfDue, type AutoplanDeps } from '../services/weeklyAutoplan.js'
import { sendAutoplanNoticesIfDue } from '../services/autoplanNotice.js'
import { budgetKeyFor } from '../services/notifications/budgetStore.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function household(tag: string) {
  const u = `${tag}_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const userId = reg.body.user.id as string
  const token = reg.body.token as string
  expect((await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount: 0, cookingFreq: '3_4_times', favoriteDishes: ['lentejas'], priority: 'varied', restrictions: [] }, token)).status).toBe(200)
  expect((await call('POST', '/menu/generate', { userId, weekStart: madridWeekStart(new Date()) }, token)).status).toBe(201)
  return { userId, token }
}

/** A Thursday 18:30 (Madrid, December: UTC+1) far ahead, so no other run has that week; its next Monday. */
function farThursday(): { now: Date; nextMonday: string } {
  const d = new Date(Date.UTC(2090 + Math.floor(Math.random() * 9), 11, 1 + Math.floor(Math.random() * 20), 17, 30))
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1)
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + 4)
  return { now: d, nextMonday: monday.toISOString().slice(0, 10) }
}

function only(userIds: string[]): AutoplanDeps {
  return {
    ...defaultAutoplanDeps,
    async load(weekStart, now) {
      const r = await defaultAutoplanDeps.load(weekStart, now)
      return { people: r.people.filter((p) => userIds.includes(p.userId)).map((p) => ({ ...p, freePlan: false })), weeks: r.weeks }
    },
  }
}

describe.skipIf(!reachable)('«vuestra semana ya está hecha» (PRO-382)', () => {
  it('claims the notice once, logs its unit and keeps the outcome on the week’s row', async () => {
    const h = await household('aviso')
    const { now, nextMonday } = farThursday()
    expect(await runWeeklyAutoplanIfDue(now, only([h.userId]))).toMatchObject({ generated: 1 })

    const at = new Date(now.getTime() + 5 * 60_000)
    const first = await sendAutoplanNoticesIfDue(at)
    expect(first?.weekStart).toBe(nextMonday)

    const scope = await resolveScope(h.userId)
    const [row] = await db.select().from(notificationSchedule).where(eq(notificationSchedule.dedupKey, autoplanKey(scope.value, nextMonday)))
    const payload = row.payload as any
    expect(payload.noticeAt).toBe(at.toISOString())
    // No channel in the smoke environment: the outcome says so.
    expect(payload.notice).toEqual({ error: expect.stringContaining('email') })

    const logged = await db
      .select()
      .from(noticeCandidates)
      .where(and(eq(noticeCandidates.budgetKey, await budgetKeyFor(h.userId)), eq(noticeCandidates.kind, 'weekly_autoplan')))
    expect(logged).toEqual([expect.objectContaining({ priority: 1, outcome: 'fallido', counted: false })])

    // Once per household and week.
    await sendAutoplanNoticesIfDue(new Date(at.getTime() + 5 * 60_000))
    const [again] = await db.select().from(notificationSchedule).where(eq(notificationSchedule.id, row.id))
    expect((again.payload as any).noticeAt).toBe(at.toISOString())
    expect(
      await db
        .select()
        .from(noticeCandidates)
        .where(and(eq(noticeCandidates.budgetKey, await budgetKeyFor(h.userId)), eq(noticeCandidates.kind, 'weekly_autoplan'))),
    ).toHaveLength(1)
  }, 120_000)

  it('nothing at night, nor before Thursday 18:00', async () => {
    const { now } = farThursday()
    expect(await sendAutoplanNoticesIfDue(new Date(now.getTime() + 29 * 3600_000))).toBeNull() // Friday 23:30 Madrid
    expect(await sendAutoplanNoticesIfDue(new Date(now.getTime() - 3600_000))).toBeNull() // Thursday 17:30
  })
})
