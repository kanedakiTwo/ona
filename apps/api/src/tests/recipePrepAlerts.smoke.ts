/**
 * Smoke (real Postgres) for PRO-220: a recipe's «preparativos con antelación»
 * become prep alerts in a household with NO prep habits; changing the day's
 * recipe drops the old alert; picking a dish late sends a short one now and
 * schedules nothing for a long one.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/recipePrepAlerts.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { menus, notificationSchedule, recipes, users } from '../db/schema.js'
import { clearPendingForMenu, enqueuePrepAlertsForMenu, prepAlertStaleReasonFor } from '../services/notificationScheduler.js'

const tag = `prep${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const WEEK = '2030-01-07' // a Monday, far in the future; Madrid is UTC+1 then
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+01:00`)

async function setup(mealTimes?: Record<string, string>) {
  const [u] = await db.insert(users).values({ username: `${tag}${Math.random().toString(36).slice(2, 6)}`, email: `${tag}${Math.random().toString(36).slice(2, 6)}@test.local`, passwordHash: 'x' }).returning({ id: users.id })
  if (mealTimes) {
    const { userMemories } = await import('../db/schema.js')
    await db.insert(userMemories).values({ userId: u.id, key: 'meal_times', value: mealTimes } as any)
  }
  const [filete] = await db.insert(recipes).values({ name: `Filete ${tag}`, servings: 2, advancePrep: [{ text: 'Saca el filete del frigorífico', hoursBefore: 1.5 }] }).returning({ id: recipes.id })
  const [garbanzos] = await db.insert(recipes).values({ name: `Garbanzos ${tag}`, servings: 2, advancePrep: [{ text: 'Pon los garbanzos en remojo', hoursBefore: 10 }] }).returning({ id: recipes.id })
  const [ensalada] = await db.insert(recipes).values({ name: `Ensalada ${tag}`, servings: 2 }).returning({ id: recipes.id })
  return { userId: u.id, filete: filete.id, garbanzos: garbanzos.id, ensalada: ensalada.id }
}

const dinnerOn = (dayIndex: number, recipeId: string, meal = 'dinner') => {
  const d: any[] = [{}, {}, {}, {}, {}, {}, {}]
  d[dayIndex] = { [meal]: { servings: null, dishes: [{ kind: 'recipe', recipeId, recipeName: 'x' }] } }
  return d
}

const rowsOf = (menuId: string) =>
  db.select().from(notificationSchedule).where(like(notificationSchedule.dedupKey, `menu:${menuId}:%`))

describe.skipIf(!reachable)('prep alerts from the recipe (PRO-220)', () => {
  it('a 1,5 h preparativo → alert at dinner − 1,5 h, with no prep habits; priority 1', async () => {
    const s = await setup()
    const [m] = await db.insert(menus).values({ userId: s.userId, weekStart: WEEK, days: dinnerOn(2, s.filete) }).returning({ id: menus.id })
    const r = await enqueuePrepAlertsForMenu(m.id, at('2030-01-07', '09:00'))
    expect(r.inserted).toBe(1)
    const [row] = await rowsOf(m.id)
    expect(row.fireAt.toISOString()).toBe(at('2030-01-09', '19:30').toISOString())
    expect(row.payload).toMatchObject({ title: 'Acuérdate: Saca el filete del frigorífico', priority: 1 })
    expect(await prepAlertStaleReasonFor(row.dedupKey)).toBeNull()

    // The day's recipe changes → the old alert goes (what the swap/dish routes do).
    await db.update(menus).set({ days: dinnerOn(2, s.ensalada) }).where(eq(menus.id, m.id))
    expect(await prepAlertStaleReasonFor(row.dedupKey)).toBe('ese plato ya no está en el menú')
    await clearPendingForMenu(m.id)
    await enqueuePrepAlertsForMenu(m.id, at('2030-01-07', '09:00'))
    expect(await rowsOf(m.id)).toEqual([])
  })

  it('picked at 13:00 for a 14:30 meal: 1,5 h goes out now, 10 h schedules nothing', async () => {
    const s = await setup({ lunch: '14:30' })
    const now = at('2030-01-07', '13:00')
    const [m] = await db.insert(menus).values({ userId: s.userId, weekStart: WEEK, days: dinnerOn(0, s.filete, 'lunch') }).returning({ id: menus.id })
    expect((await enqueuePrepAlertsForMenu(m.id, now)).inserted).toBe(1)
    const [row] = await rowsOf(m.id)
    expect(row.fireAt.toISOString()).toBe(now.toISOString())
    expect(row.payload.title).toBe('Para la comida: saca el filete del frigorífico')

    const [m2] = await db.insert(menus).values({ userId: s.userId, weekStart: '2030-01-14', days: dinnerOn(0, s.garbanzos, 'lunch') }).returning({ id: menus.id })
    expect((await enqueuePrepAlertsForMenu(m2.id, at('2030-01-14', '13:00'))).inserted).toBe(0)
    expect(await rowsOf(m2.id)).toEqual([])
  })
})
