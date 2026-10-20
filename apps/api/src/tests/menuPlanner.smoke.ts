/**
 * Smoke (real API + Postgres) for PRO-253 and PRO-255 (specs/smart-menu.md,
 * specs/household-profile.md → «Who reads the ficha»):
 *   - a fact of the ficha («Sin horno hasta nuevo aviso») reaches the
 *     planner's prompt and takes oven recipes out of its candidates;
 *   - every generated menu gets its shadow proposal in `menu_plans`
 *     (without a key in CI: a `skipped` row);
 *   - one shadow run end to end with the model simulated: the proposal is
 *     checked and stored, the household's menu is untouched.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/menuPlanner.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { menuPlans, menus, profileFacts, users } from '../db/schema.js'
import { defaultShadowDeps, loadShadowContext, planMenuInShadow, saveShadowPlan } from '../services/menuPlannerShadow.js'
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

const mondayOf = (d: Date) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7))
  return x.toISOString().slice(0, 10)
}

describe.skipIf(!reachable)('menú inteligente a la sombra (PRO-253, PRO-255)', () => {
  it('reads the ficha, stores a shadow proposal per generated menu and never touches the menu', async () => {
    const u = `planner_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const token = reg.body.token as string
    const onb = await call('POST', `/user/${userId}/onboarding`, {
      adults: 2, kidsCount: 0, cookingFreq: '3_4_times', favoriteDishes: ['lentejas'], priority: 'quick', restrictions: [], weekdayCooking: 'rapido',
    }, token)
    expect(onb.status).toBe(200)
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    const householdId = user.primaryHouseholdId!
    await db.insert(profileFacts).values({ householdId, type: 'temporary_situation', value: { description: 'Sin horno hasta nuevo aviso' }, origin: 'ai_nightly', confidence: 0.9 })

    const weekStart = mondayOf(new Date())
    const gen = await call('POST', '/menu/generate', { userId, weekStart }, token)
    expect(gen.status).toBe(201)
    const menuId = gen.body.id as string
    const days = gen.body.days as DayMenu[]

    // The generator itself respects the ficha now (PRO-253): nothing with an oven.
    const ctx = await loadShadowContext({ menuId, userId, weekStart, days }, db)
    const needsOven = (id: string) => ctx.recipes.find((r) => r.id === id)?.equipment?.some((e) => e.toLowerCase() === 'horno')
    const generatedIds = days.flatMap((d) => Object.values(d ?? {}).flatMap((s) => (s?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeId] : []))))
    expect(generatedIds.filter(needsOven)).toEqual([])
    expect(ctx.prompt).toContain('Sin horno hasta nuevo aviso')
    expect(ctx.candidates.length).toBeGreaterThan(0)
    expect(ctx.candidates.filter((c) => needsOven(c.recipe.id))).toEqual([])
    expect(ctx.slots.length).toBeGreaterThan(0)

    // The route started the shadow run: a row for this menu (skipped without a key).
    let row: typeof menuPlans.$inferSelect | undefined
    for (let i = 0; i < 40 && !row; i++) {
      ;[row] = await db.select().from(menuPlans).where(eq(menuPlans.menuId, menuId)).limit(1)
      if (!row) await new Promise((r) => setTimeout(r, 250))
    }
    expect(row).toBeTruthy()
    expect(['ok', 'partial', 'fallback', 'skipped']).toContain(row!.status)

    const [before] = await db.select().from(menus).where(eq(menus.id, menuId))

    // One run end to end with the model simulated: the first candidates, in order.
    const deps = { ...defaultShadowDeps(db), capExceeded: async () => false, call: async () => ({
      stop_reason: 'end_turn',
      usage: { input_tokens: 9000, output_tokens: 3000 },
      content: [{ type: 'text', text: JSON.stringify({ slots: ctx.slots.map((s, i) => ({ day: s.dayIndex, meal: s.meal, ref: ctx.candidates[i % ctx.candidates.length].ref, why: 'porque sí', leftoverOfDay: -1, leftoverOfMeal: '' })) }) }],
    }) }
    const planned = await planMenuInShadow({ menuId, userId, weekStart, days }, deps)
    expect(['ok', 'partial']).toContain(planned.status)
    expect(planned.costMicros).toBeGreaterThan(0)
    await saveShadowPlan(planned, db)
    const [saved] = await db.select().from(menuPlans).where(eq(menuPlans.menuId, menuId)).orderBy(desc(menuPlans.createdAt)).limit(1)
    expect(saved.model).toBe('claude-opus-5-5')
    expect((saved.slots as unknown[]).length).toBe(ctx.slots.length)
    expect(saved.plannerScore).toBeTruthy()

    // The household's menu is the generator's, untouched.
    const [menu] = await db.select().from(menus).where(eq(menus.id, menuId))
    expect(menu.days).toEqual(before.days)
  }, 60_000)
})
