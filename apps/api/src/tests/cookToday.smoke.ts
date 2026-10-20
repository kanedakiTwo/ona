/**
 * Smoke (real Postgres) for PRO-230: once «hoy cocina Pablo» is recorded,
 * that day's pending prep alerts move to Pablo, and alerts enqueued later for
 * that day are his too; other days stay with whoever owns the menu.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/cookToday.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdMembers, households, ingredients, menus, notificationSchedule, recipeIngredients, recipes, userMemories, users } from '../db/schema.js'
import { cooksOfWeek, dbCookTodayDeps } from '../services/cookToday.js'
import { clearPendingForMenu, enqueuePrepAlertsForMenu } from '../services/notificationScheduler.js'
import { menuDayOf } from '../services/assistant/menuDay.js'

const tag = `cook${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const WEEK = '2030-01-07' // a Monday, in the future

async function user(n: string) {
  const [u] = await db.insert(users).values({ username: `${tag}${n}`, email: `${tag}${n}@test.local`, passwordHash: 'x' }).returning({ id: users.id })
  return u.id
}

describe.skipIf(!reachable)('who cooks today (PRO-230)', () => {
  it("that day's prep alerts go to the cook, now and when re-enqueued", async () => {
    const ana = await user('ana')
    const pablo = await user('pablo')
    const [h] = await db.insert(households).values({ ownerId: ana, name: 'Casa' }).returning({ id: households.id })
    await db.insert(householdMembers).values([
      { householdId: h.id, userId: ana, role: 'owner' },
      { householdId: h.id, userId: pablo, role: 'member' },
    ])
    await db.insert(userMemories).values({ userId: ana, key: 'prep_habits', value: ['congelo la carne'] } as any)
    const [ing] = await db.insert(ingredients).values({ name: `Ternera ${tag}`, prepRequirements: { method: 'thaw_24h' } }).returning({ id: ingredients.id })
    const [rec] = await db.insert(recipes).values({ name: `Guiso ${tag}`, servings: 2 }).returning({ id: recipes.id })
    await db.insert(recipeIngredients).values({ recipeId: rec.id, ingredientId: ing.id, quantity: 300, unit: 'g' } as any)
    const d: any[] = [{}, {}, {}, {}, {}, {}, {}]
    d[2] = { dinner: { servings: null, dishes: [{ kind: 'recipe', recipeId: rec.id, recipeName: 'Guiso' }] } }
    d[4] = { dinner: { servings: null, dishes: [{ kind: 'recipe', recipeId: rec.id, recipeName: 'Guiso' }] } }
    const [m] = await db.insert(menus).values({ userId: ana, householdId: h.id, weekStart: WEEK, days: d }).returning({ id: menus.id })

    expect((await enqueuePrepAlertsForMenu(m.id)).inserted).toBe(2)
    const owners = async () =>
      Object.fromEntries(
        (await db.select().from(notificationSchedule).where(like(notificationSchedule.dedupKey, `menu:${m.id}:%`))).map((r) => [r.dedupKey.split(':')[3], r.userId]),
      )
    expect(await owners()).toEqual({ '2': ana, '4': ana })

    // «el miércoles cocina Pablo» (day 2): the pending alert moves to him.
    await dbCookTodayDeps().assign({ householdId: h.id, menuId: m.id, day: menuDayOf(WEEK, 2), cookId: pablo, requesterId: ana })
    expect(await owners()).toEqual({ '2': pablo, '4': ana })
    expect(await cooksOfWeek(h.id, WEEK)).toEqual(new Map([[2, pablo]]))

    // A later change re-enqueues the week: still Pablo's on that day.
    await clearPendingForMenu(m.id)
    await enqueuePrepAlertsForMenu(m.id)
    expect(await owners()).toEqual({ '2': pablo, '4': ana })

    await db.delete(households).where(eq(households.id, h.id))
  })
})
