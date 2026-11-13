/**
 * Smoke (Postgres de verdad) de PRO-1199, specs/newsletter.md → «Tus números
 * con Mimoia»: lo que `loadHouseholdNumbers` cuenta de una casa (el menú de
 * la semana y sus platos, lo cocinado, lo nuevo y la lista mandada) y que una
 * casa sin nada no da bloque.
 */
import { describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { cookLogs, menus, recipes, usageEvents, users } from '../db/schema.js'
import { loadHouseholdNumbers, numbersBlock } from '../services/newsletterNumbers.js'
import { madridParts, madridWeekStart } from '../services/madridTime.js'

async function register(username: string) {
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@test.local`, password: 'smokepass123', ageConfirmed: true }),
  })
  expect(r.status).toBe(201)
  const id = ((await r.json()) as any).user.id as string
  const [me] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, id))
  return { id, householdId: me.householdId!, email: `${username}@test.local` }
}

const run = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const DAY = 86_400_000

describe.skipIf(!reachable)('tus números con Mimoia (PRO-1199)', () => {
  it('cuenta lo de la casa y una casa sin nada no da bloque', async () => {
    const ana = await register(`nn_ana_${run}`)
    const bea = await register(`nn_bea_${run}`)
    const [lentejas, pollo] = await db
      .insert(recipes)
      .values([
        { name: `Lentejas nn ${run}`, servings: 2, authorId: ana.id },
        { name: `Pollo nn ${run}`, servings: 2, authorId: ana.id },
      ])
      .returning({ id: recipes.id })
    const now = new Date()
    const today = madridParts(now).weekday
    const dish = (recipeId: string, variant?: string) => ({ kind: 'recipe', recipeId, ...(variant ? { variant } : {}) })
    const days = Array.from({ length: 7 }, (_, i) =>
      i === today ? { lunch: { dishes: [dish(lentejas.id), dish(pollo.id)] }, dinner: { dishes: [dish(pollo.id, 'leftover')] } } : {},
    )
    await db.delete(menus).where(eq(menus.householdId, ana.householdId))
    await db.insert(menus).values({ userId: ana.id, householdId: ana.householdId, weekStart: madridWeekStart(now), days })
    await db.insert(cookLogs).values([
      // Las lentejas ya se habían cocinado hace 40 días: no son nuevas.
      { userId: ana.id, householdId: ana.householdId, recipeId: lentejas.id, cookedAt: new Date(now.getTime() - 40 * DAY) },
      { userId: ana.id, householdId: ana.householdId, recipeId: lentejas.id, cookedAt: new Date(now.getTime() - 2 * DAY) },
      { userId: ana.id, householdId: ana.householdId, recipeId: pollo.id, cookedAt: new Date(now.getTime() - DAY) },
    ])
    await db.insert(usageEvents).values({ userId: ana.id, householdId: ana.householdId, name: 'shopping_list_shared', createdAt: new Date(now.getTime() - DAY) })
    try {
      const out = await loadHouseholdNumbers([ana.id, bea.id], now)
      expect(out.get(ana.id)?.week).toEqual({ menuWeeks: 1, dishes: 2, cooked: 2, newRecipes: 1, listSent: true })
      expect(numbersBlock(out.get(ana.id))?.lines).toEqual([
        'El menú de la semana hecho (2 platos)',
        '2 recetas cocinadas',
        '1 receta nueva probada',
        'La lista de la compra mandada',
      ])
      expect(numbersBlock(out.get(bea.id))).toBeNull()
    } finally {
      await db.delete(usageEvents).where(eq(usageEvents.userId, ana.id))
      await db.delete(recipes).where(inArray(recipes.id, [lentejas.id, pollo.id]))
      await db.delete(users).where(inArray(users.id, [ana.id, bea.id]))
    }
  })
})
