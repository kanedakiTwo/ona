/**
 * Smoke (real API + Postgres) for PRO-381 (specs/menus.md «Piloto
 * automático»): a Thursday end to end against the database — the household
 * that had a menu gets next week from the real generator, once; a household
 * that made next week by hand is left alone; the /menu card shows until the
 * person opens that week.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/weeklyAutoplan.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { menus, notificationSchedule, users } from '../db/schema.js'
import { madridWeekStart } from '../services/madridTime.js'
import { menuHasDishes } from '../services/menuWeek.js'
import { resolveScope } from '../services/scopeResolver.js'
import {
  autoplanKey,
  autoplanNoticeFor,
  defaultAutoplanDeps,
  markAutoplanViewed,
  runWeeklyAutoplanIfDue,
  type AutoplanDeps,
} from '../services/weeklyAutoplan.js'
import type { DayMenu } from '@ona/shared'

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

/** The real DB deps, with the read limited to these test households. */
function only(userIds: string[]): AutoplanDeps {
  return {
    ...defaultAutoplanDeps,
    async load(weekStart, now) {
      const r = await defaultAutoplanDeps.load(weekStart, now)
      return { people: r.people.filter((p) => userIds.includes(p.userId)), weeks: r.weeks }
    },
  }
}

async function weekRows(userId: string, weekStart: string) {
  const [u] = await db.select({ h: users.primaryHouseholdId }).from(users).where(eq(users.id, userId))
  return db.select().from(menus).where(and(eq(menus.householdId, u.h!), eq(menus.weekStart, weekStart)))
}

describe.skipIf(!reachable)('piloto automático del jueves (PRO-381)', () => {
  it('makes next week once from the real generator, never on top of a week made by hand, and shows the card until opened', async () => {
    const auto = await household('jueves')
    const hand = await household('amano')
    const { now, nextMonday } = farThursday()

    // The second household makes that week itself first.
    expect((await call('POST', '/menu/generate', { userId: hand.userId, weekStart: nextMonday }, hand.token)).status).toBe(201)
    const handBefore = await weekRows(hand.userId, nextMonday)

    const deps = only([auto.userId, hand.userId])
    const r = await runWeeklyAutoplanIfDue(now, deps)
    expect(r).toMatchObject({ weekStart: nextMonday, generated: 1, failed: 0 })
    expect(r!.skipped.week_done).toBe(1)

    const made = await weekRows(auto.userId, nextMonday)
    expect(made).toHaveLength(1)
    expect(menuHasDishes(made[0].days as DayMenu[])).toBe(true)
    expect(await weekRows(hand.userId, nextMonday)).toHaveLength(handBefore.length)

    // Once per household and week.
    const again = await runWeeklyAutoplanIfDue(new Date(now.getTime() + 10 * 60_000), deps)
    expect(again?.generated).toBe(0)
    expect(await weekRows(auto.userId, nextMonday)).toHaveLength(1)
    const scope = await resolveScope(auto.userId)
    const [claim] = await db.select().from(notificationSchedule).where(eq(notificationSchedule.dedupKey, autoplanKey(scope.value, nextMonday)))
    expect(claim).toMatchObject({ status: 'sent', userId: auto.userId })
    expect((claim.payload as any).menuId).toBe(made[0].id)

    // The card: until this person opens that week.
    const later = new Date(now.getTime() + 60 * 60_000)
    expect(await autoplanNoticeFor(auto.userId, later)).toEqual({ weekStart: nextMonday, weekEnd: expect.any(String) })
    expect(await autoplanNoticeFor(hand.userId, later)).toBeNull()
    expect(await markAutoplanViewed(auto.userId, nextMonday)).toBe(true)
    expect(await markAutoplanViewed(auto.userId, nextMonday)).toBe(false)
    expect(await autoplanNoticeFor(auto.userId, later)).toBeNull()

    // The route answers (today there is no Thursday week for this account).
    const route = await call('GET', '/menu/autoplan', undefined, auto.token)
    expect(route).toEqual({ status: 200, body: { notice: null } })
    expect((await call('POST', '/menu/autoplan/viewed', { weekStart: 'x' }, auto.token)).status).toBe(400)
  }, 120_000)

  it('switched off in Perfil → Avisos: no week', async () => {
    const off = await household('apagado')
    expect((await call('PATCH', '/notifications/prefs', { prefs: { weekly_autoplan: false } }, off.token)).status).toBe(200)
    const { now, nextMonday } = farThursday()
    const r = await runWeeklyAutoplanIfDue(now, only([off.userId]))
    expect(r).toMatchObject({ generated: 0 })
    expect(r!.skipped.switched_off).toBe(1)
    expect(await weekRows(off.userId, nextMonday)).toHaveLength(0)
  }, 60_000)
})
