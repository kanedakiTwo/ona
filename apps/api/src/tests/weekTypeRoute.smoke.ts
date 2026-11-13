/**
 * Smoke for the «semana tipo» (D-182) against a running API + Postgres:
 * GET and PUT one slot (the others are never touched), what the PUT refuses,
 * that saving the profile's settings never changes it, the migration once and
 * repeatable, and a generated week that follows its slots two weeks running.
 *
 *   API_URL=http://localhost:8717 DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/weekTypeRoute.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdWeekTypes, profileChanges, profileFacts, users } from '../db/schema.js'
import { applyWeekTypeMigration } from '../services/weekType.js'

async function call(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: r.status, body }
}

function monday(offsetWeeks: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 * offsetWeeks)
  return d.toISOString().slice(0, 10)
}

async function freshUser(tag: string) {
  const u = `${tag}_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const auth = { Authorization: `Bearer ${reg.body.token}` }
  const userId = reg.body.user.id as string
  expect((await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'varied' }, auth)).status).toBe(200)
  return { auth, userId }
}

describe.skipIf(!reachable)('semana tipo smoke', () => {
  it('a PUT of one slot never touches the others; bad slots are refused', async () => {
    const { auth } = await freshUser('st_put')
    const first = await call('GET', '/households/me/week-type', undefined, auth)
    expect(first.status).toBe(200)
    expect(first.body.days).toHaveLength(7)
    // A new household: lunch and dinner every day, no breakfast.
    expect(first.body.days[0].lunch.off).toBeUndefined()
    expect(first.body.days[0].breakfast).toEqual({ off: true })

    const pizza = await call('PUT', '/households/me/week-type/4/dinner', { options: [{ kind: 'type', type: 'pizza' }] }, auth)
    expect(pizza.status).toBe(200)
    expect(pizza.body.days[4].dinner.options).toEqual([{ kind: 'type', type: 'pizza' }])
    expect(pizza.body.days[4].dinner.since).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect((await call('PUT', '/households/me/week-type/0/lunch', { diners: 3 }, auth)).status).toBe(200)
    const after = (await call('GET', '/households/me/week-type', undefined, auth)).body.days
    expect(after[4].dinner.options).toEqual([{ kind: 'type', type: 'pizza' }])
    expect(after[0].lunch).toEqual({ diners: 3 })
    for (let d = 0; d < 7; d++) {
      for (const m of ['breakfast', 'lunch', 'snack', 'dinner']) {
        if ((d === 4 && m === 'dinner') || (d === 0 && m === 'lunch')) continue
        expect(after[d][m]).toEqual(first.body.days[d][m])
      }
    }

    // A táper only where it can be, and alone; unknown types; recipes not in the catalogue.
    expect((await call('PUT', '/households/me/week-type/2/dinner', { options: [{ kind: 'taper' }] }, auth)).status).toBe(400)
    expect((await call('PUT', '/households/me/week-type/0/lunch', { options: [{ kind: 'taper' }] }, auth)).status).toBe(400)
    expect((await call('PUT', '/households/me/week-type/2/lunch', { options: [{ kind: 'taper' }, { kind: 'any' }] }, auth)).status).toBe(400)
    expect((await call('PUT', '/households/me/week-type/2/lunch', { options: [{ kind: 'type', type: 'tortilla-de-patatas' }] }, auth)).status).toBe(400)
    expect((await call('PUT', '/households/me/week-type/2/lunch', { options: [{ kind: 'recipe', recipeId: '00000000-0000-0000-0000-000000000000', name: 'x' }] }, auth)).status).toBe(404)
    expect((await call('PUT', '/households/me/week-type/7/lunch', {}, auth)).status).toBe(400)
  }, 60_000)

  it('saving the profile (settings with the old plantilla keys) never changes the week type', async () => {
    const { auth, userId } = await freshUser('st_profile')
    expect((await call('PUT', '/households/me/week-type/4/dinner', { options: [{ kind: 'type', type: 'pizza' }] }, auth)).status).toBe(200)
    const before = (await call('GET', '/households/me/week-type', undefined, auth)).body.days
    const template = { preferences: { restrictions: [] }, mealTemplate: { lunes: { cena: 2 } }, mealDishCounts: { dinner: 3 }, taperDays: ['martes'], fixedMeals: [] }
    expect((await call('PUT', `/user/${userId}/settings`, { template }, auth)).status).toBe(200)
    expect((await call('GET', '/households/me/week-type', undefined, auth)).body.days).toEqual(before)
  }, 60_000)

  it('a new household gets its week type at once; the migration creates what is missing once and archives the fixed dishes it takes', async () => {
    const { userId } = await freshUser('st_mig')
    const [u] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
    const householdId = u.householdId!
    // Created with the household (lunch and dinner every day).
    const [created] = await db.select().from(householdWeekTypes).where(eq(householdWeekTypes.householdId, householdId))
    expect((created.slots as any[])[0]).toMatchObject({ lunch: {}, dinner: {}, breakfast: { off: true } })

    // A household from before: no row, and a «pizza el viernes por la noche» in its ficha.
    await db.delete(householdWeekTypes).where(eq(householdWeekTypes.householdId, householdId))
    const [fact] = await db.insert(profileFacts).values({
      householdId, type: 'fixed_dish', value: { dish: 'pizza', days: ['viernes'], meal: 'dinner' }, origin: 'user', confidence: 1,
      evidence: [{ signal: 'chat', date: '2026-11-01', summary: 'Pizza los viernes' }],
    }).returning()
    await applyWeekTypeMigration(db)
    const [row] = await db.select().from(householdWeekTypes).where(eq(householdWeekTypes.householdId, householdId))
    expect((row.slots as any[])[4].dinner.options).toEqual([{ kind: 'type', type: 'pizza' }])
    const [archived] = await db.select().from(profileFacts).where(eq(profileFacts.id, fact.id))
    expect(archived.status).toBe('retired')
    const [change] = await db.select().from(profileChanges).where(and(eq(profileChanges.factId, fact.id), eq(profileChanges.action, 'fact_retired')))
    expect(change.reason).toMatch(/semana tipo/)

    expect(await applyWeekTypeMigration(db)).toBe(0)
    const [again] = await db.select().from(householdWeekTypes).where(eq(householdWeekTypes.householdId, householdId))
    expect(again.slots).toEqual(row.slots)
    expect(again.updatedAt.getTime()).toBe(row.updatedAt.getTime())
  }, 120_000)

  it('a generated week follows its slots two weeks running (pizza on Friday, «no hay» on Sunday dinner)', async () => {
    const { auth, userId } = await freshUser('st_gen')
    expect((await call('PUT', '/households/me/week-type/4/dinner', { options: [{ kind: 'type', type: 'pizza' }] }, auth)).status).toBe(200)
    expect((await call('PUT', '/households/me/week-type/6/dinner', { off: true }, auth)).status).toBe(200)
    for (const weekStart of [monday(1), monday(2)]) {
      const gen = await call('POST', '/menu/generate', { userId, weekStart }, auth)
      expect([200, 201]).toContain(gen.status)
      const friday = gen.body.days[4].dinner.dishes[0]
      // The seed's «Pizza», or its name when it doesn't fit.
      expect(friday.kind === 'recipe' ? friday.recipeName : friday.text).toMatch(/pizza/i)
      expect(gen.body.days[6].dinner).toBeUndefined()
    }
  }, 180_000)
})
