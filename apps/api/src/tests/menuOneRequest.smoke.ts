/**
 * Smoke (real API + Postgres) for PRO-1298: one request, one menu, and the
 * menu's wait in /admin/usage.
 *
 *   - two generate_weekly_menu at once for the same person and week leave a
 *     single menu row; the same request sent before that menu was made
 *     («¿hola? el menú», queued behind the slow turn) leaves no second one;
 *   - loadMenuWaitReport reads the WhatsApp turns: the tool's own ms and the
 *     whole turn, p50 / p95 of this week.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/menuOneRequest.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { menus, whatsappMessages } from '../db/schema.js'
import { skills } from '../services/assistant/skills.js'
import { madridWeekStart } from '../services/madridTime.js'
import { loadMenuWaitReport } from '../services/menuWaitReport.js'

const tag = `unmenu${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const generate = skills.find((s) => s.name === 'generate_weekly_menu')!

async function register(i: number) {
  const u = `${tag}${i}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true }),
  })
  const body = await r.json()
  expect(r.status, JSON.stringify(body)).toBe(201)
  return body.user.id as string
}

const weekMenus = async (userId: string) =>
  (await db.select({ id: menus.id }).from(menus).where(and(eq(menus.userId, userId), eq(menus.weekStart, madridWeekStart(new Date()))))).length

describe.skipIf(!reachable)('one request, one menu (PRO-1298)', () => {
  it('two requests at once, and the same one again after it: a single menu', async () => {
    const userId = await register(1)
    const asked = new Date()
    const [a, b] = await Promise.all([
      generate.handler({}, { userId, db, channel: 'whatsapp', requestedAt: asked }),
      generate.handler({}, { userId, db, channel: 'whatsapp', requestedAt: asked }),
    ])
    expect([a.summary, b.summary].filter((s) => s.includes('Menu generado'))).toHaveLength(1)
    expect(await weekMenus(userId)).toBe(1)

    // Queued behind that turn, the repeat even asks to remake the week: no.
    const again = await generate.handler({ replaceExisting: true }, { userId, db, channel: 'whatsapp', requestedAt: asked })
    expect(again.summary).toMatch(/No he generado otro/)
    expect(await weekMenus(userId)).toBe(1)
  }, 60_000)

  it('the menu\'s wait: this week\'s tool and turn durations in the report', async () => {
    const userId = await register(2)
    const before = (await loadMenuWaitReport({ weeks: 1, includeInternal: true })).weeks[0]
    // The fictitious 600 000 NNN block.
    const phone = `34600000${100 + Math.floor(Math.random() * 900)}`
    const turn = (ms: number, toolMs: number, tool = 'generate_weekly_menu') => ({
      phone, userId, direction: 'in', kind: 'text', body: 'hazme el menú', status: 'processed',
      meta: { tools: [tool], ms, toolTrace: [{ name: tool, input: '{}', summary: 'Menu generado', ms: toolMs }] } as any,
    })
    await db.insert(whatsappMessages).values([turn(20_000, 3_000), turn(90_000, 4_000), turn(45_000, 2_500, 'complete_onboarding')])
    const after = (await loadMenuWaitReport({ weeks: 1, includeInternal: true })).weeks[0]
    expect(after.generate.n - before.generate.n).toBe(2)
    expect(after.generateTurn.n - before.generateTurn.n).toBe(2)
    expect(after.generateTurn.over60 - before.generateTurn.over60).toBe(1)
    expect(after.signupTurn.n - before.signupTurn.n).toBe(1)
    expect(after.signup.n - before.signup.n).toBe(1)
  }, 30_000)

  it('GET /admin/usage carries menuWait', async () => {
    const token = process.env.METRICS_READ_TOKEN
    if (!token) return
    const r = await fetch(`${API_URL}/admin/usage?days=1`, { headers: { 'x-metrics-token': token } })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.menuWait.goalS).toBe(60)
    expect(body.menuWait.weeks.length).toBeGreaterThan(0)
    expect(body.menuWait.definition).toMatch(/PRO-1298/)
  }, 30_000)
})
