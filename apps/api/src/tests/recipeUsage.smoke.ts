/**
 * Smoke (Postgres de verdad) de PRO-1120, specs/metrics.md «Uso por receta»:
 * `loadRecipeUsageReport` con el SQL real sobre un hogar propio y un menú
 * inventado. Dos recetas del catálogo propias de esta ejecución (para no
 * depender de lo que haya en la base) y una del usuario, que no sale.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { cookLogs, menuEdits, menus, recipes, users } from '../db/schema.js'
import { addDays, madridParts, madridWeekStart } from '../services/madridTime.js'
import { loadRecipeUsageReport } from '../services/recipeUsageReport.js'

const run = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const created: string[] = []

describe.skipIf(!reachable)('uso por receta (PRO-1120)', () => {
  afterAll(async () => {
    if (created.length > 0) await db.delete(recipes).where(inArray(recipes.id, created))
  })

  it('cuenta veces en el menú, cambiada y cocinada, solo del catálogo y sin hogares', async () => {
    const u = `ru_${run}`
    const r = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true }),
    })
    expect(r.status).toBe(201)
    const reg = (await r.json()) as any
    const userId = reg.user.id as string
    const token = reg.token as string
    const [me] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId))
    const householdId = me.householdId!

    const rows = await db
      .insert(recipes)
      .values([
        { name: `Lentejas smoke ${run}`, servings: 2 },
        { name: `Merluza smoke ${run}`, servings: 2 },
        { name: `Mía smoke ${run}`, servings: 2, authorId: userId },
      ])
      .returning({ id: recipes.id })
    created.push(...rows.map((x) => x.id))
    const [lentejas, merluza, mia] = created

    const dish = (recipeId: string, variant?: string) => ({ kind: 'recipe', recipeId, ...(variant ? { variant } : {}) })
    const days = Array.from({ length: 7 }, () => ({}) as Record<string, unknown>)
    days[0] = { lunch: { dishes: [dish(lentejas)] }, dinner: { dishes: [dish(merluza)] } }
    days[1] = { lunch: { dishes: [dish(lentejas, 'leftover'), dish(mia)] } }
    days[2] = { dinner: { dishes: [dish(lentejas)] } }
    const [menu] = await db
      .insert(menus)
      .values({ userId, householdId, weekStart: madridWeekStart(), days })
      .returning({ id: menus.id })
    // Una semana de hace dos meses no entra en 28 días.
    await db.insert(menus).values({ userId, householdId, weekStart: addDays(madridWeekStart(), -63), days })

    await db.insert(menuEdits).values([
      { householdId, menuId: menu.id, userId, day: 3, meal: 'dinner', action: 'swap', beforeRecipeId: merluza, afterRecipeId: lentejas, actor: 'user', channel: 'web' },
      { householdId, menuId: menu.id, userId, day: 4, meal: 'dinner', action: 'swap', beforeRecipeId: mia, afterRecipeId: merluza, actor: 'mimo', channel: 'whatsapp' },
      { householdId, menuId: menu.id, userId, day: 5, meal: 'lunch', action: 'remove', beforeRecipeId: merluza, actor: 'user', channel: 'web' },
    ])
    await db.insert(cookLogs).values([
      { userId, householdId, recipeId: lentejas, menuId: menu.id, dayIndex: 0, meal: 'lunch' },
      { userId, householdId, recipeId: lentejas },
      { userId, householdId, recipeId: merluza, cookedAt: new Date(Date.now() - 40 * 86_400_000) },
    ])

    const report = await loadRecipeUsageReport({ days: 28 })
    expect(report.to).toBe(madridParts(new Date()).isoDate)
    const mine = report.recipes.filter((x) => created.includes(x.recipeId))
    expect(mine).toEqual([
      { recipeId: merluza, name: `Merluza smoke ${run}`, inMenu: 1, swappedOut: 1, cooked: 0, cookedFromMenu: 0, swapRate: 0.5 },
      { recipeId: lentejas, name: `Lentejas smoke ${run}`, inMenu: 2, swappedOut: 0, cooked: 2, cookedFromMenu: 1, swapRate: 0 },
    ])
    expect(JSON.stringify(report)).not.toContain(householdId)
    expect(JSON.stringify(report)).not.toContain(userId)

    // Borrar la cuenta (y su hogar, del que era la única) se lleva el menú y lo cocinado.
    const del = await fetch(`${API_URL}/user/${userId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: 'smokepass123', ageConfirmed: true }),
    })
    expect(del.status).toBe(200)
  })
})
