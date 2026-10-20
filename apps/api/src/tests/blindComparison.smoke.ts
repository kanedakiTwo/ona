/**
 * Smoke (real API + Postgres) for PRO-256: a test account (@example.com)
 * sees its menu's two weeks as A and B, votes, and the report counts it;
 * any other account gets 404.
 *
 *   API_URL=… DATABASE_URL=… METRICS_READ_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/blindComparison.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { menuBlindVotes } from '../db/schema.js'
import { madridWeekStart } from '../services/madridTime.js'
import { defaultShadowDeps, loadShadowContext, planMenuInShadow, saveShadowPlan } from '../services/menuPlannerShadow.js'
import type { DayMenu } from '@ona/shared'

async function call(method: string, path: string, payload?: unknown, token?: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function household(domain: string) {
  const u = `ciegas_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call('POST', '/register', { username: u, email: `${u}@${domain}`, password: 'smokepass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const userId = reg.body.user.id as string
  const token = reg.body.token as string
  expect((await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount: 0, cookingFreq: '3_4_times', favoriteDishes: ['lentejas'], priority: 'varied', restrictions: [] }, token)).status).toBe(200)
  const weekStart = madridWeekStart(new Date())
  const gen = await call('POST', '/menu/generate', { userId, weekStart }, token)
  expect(gen.status).toBe(201)
  const menuId = gen.body.id as string
  const days = gen.body.days as DayMenu[]
  const ctx = await loadShadowContext({ menuId, userId, weekStart, days }, db)
  const deps = { ...defaultShadowDeps(db), capExceeded: async () => false, call: async () => ({
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 100 },
    content: [{ type: 'text', text: JSON.stringify({ slots: ctx.slots.map((s, i) => ({ day: s.dayIndex, meal: s.meal, ref: ctx.candidates[(i + 1) % ctx.candidates.length].ref, why: 'secreto', leftoverOfDay: -1, leftoverOfMeal: '' })) }) }],
  }) }
  await saveShadowPlan(await planMenuInShadow({ menuId, userId, weekStart, days }, deps), db)
  return { userId, token, menuId }
}

describe.skipIf(!reachable)('comparación a ciegas (PRO-256)', () => {
  it('a test household sees A and B and votes; the report counts it; other accounts get 404', async () => {
    const h = await household('example.com')
    const read = await call('GET', `/menu/${h.menuId}/a-ciegas`, undefined, h.token)
    expect(read.status).toBe(200)
    expect(Object.keys(read.body.weeks)).toEqual(['A', 'B'])
    expect(read.body.weeks.A).toHaveLength(7)
    expect(JSON.stringify(read.body)).not.toMatch(/secreto|planner|generator|recipeId/)
    expect(read.body.choice).toBeNull()

    expect((await call('POST', `/menu/${h.menuId}/a-ciegas`, { choice: 'C' }, h.token)).status).toBe(400)
    expect((await call('POST', `/menu/${h.menuId}/a-ciegas`, { choice: 'A', reason: 'Más variada' }, h.token)).status).toBe(201)
    expect((await call('POST', `/menu/${h.menuId}/a-ciegas`, { choice: 'B', reason: 'Mejor la B' }, h.token)).status).toBe(201)
    const votes = await db.select().from(menuBlindVotes).where(eq(menuBlindVotes.menuId, h.menuId))
    expect(votes).toHaveLength(1)
    expect(votes[0]).toMatchObject({ label: 'B', reason: 'Mejor la B' })
    expect((await call('GET', `/menu/${h.menuId}/a-ciegas`, undefined, h.token)).body.choice).toBe('B')

    const metricsToken = process.env.METRICS_READ_TOKEN ?? 'smoke-metrics-token'
    const report = await call('GET', '/admin/menu-planner/comparison', undefined, undefined, { 'x-metrics-token': metricsToken })
    expect(report.status).toBe(200)
    const total = report.body.households.reduce((n: number, r: any) => n + r.votes.planner + r.votes.generator + r.votes.tie, 0)
    expect(total).toBeGreaterThanOrEqual(1)
    // The token gets no household id and no reasons, only how many.
    expect(report.body.households.every((r: any) => r.householdId === undefined && r.reasons === undefined)).toBe(true)
    expect(report.body.households.reduce((n: number, r: any) => n + r.reasonCounts.planner + r.reasonCounts.generator + r.reasonCounts.tie, 0)).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(report.body)).not.toContain('Mejor la B')

    const other = await household('test.local')
    expect((await call('GET', `/menu/${other.menuId}/a-ciegas`, undefined, other.token)).status).toBe(404)
    // Nor can a test account read someone else's menu.
    expect((await call('GET', `/menu/${other.menuId}/a-ciegas`, undefined, h.token)).status).toBe(404)
  }, 90_000)
})
