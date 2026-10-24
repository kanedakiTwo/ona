/**
 * Smoke (real Postgres) for PRO-345: a catalogue recipe edited to carry
 * gluten after it entered a gluten-free household's menu is replaced by one
 * that fits; a deleted recipe never stays in a menu.
 *
 * Needs Postgres (DATABASE_URL) and a running API (API_URL, for `reachable`),
 * like the CI smoke job; skips otherwise.
 */
import { describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { ingredients, menus, recipeIngredients, recipes, users } from '../db/schema.js'
import { recheckSavedMenus } from '../services/menuRecipeRecheck.js'
import { compileRestrictions, violatesRestrictions } from '../services/dietaryRestrictions.js'
import { madridWeekStart } from '../services/madridTime.js'
import type { DayMenu, RecipeDish } from '@ona/shared'

const tag = `rchk${Date.now()}${Math.random().toString(36).slice(2, 6)}`

describe.skipIf(!reachable)('saved menus when a recipe changes (PRO-345)', () => {
  it('fajitas that now carry wheat leave the gluten-free menu; a deleted recipe too', async () => {
    const [u] = await db
      .insert(users)
      .values({ username: tag, email: `${tag}@test.local`, passwordHash: 'x', restrictions: ['sin gluten'] })
      .returning({ id: users.id })
    const [pollo] = await db.insert(ingredients).values({ name: `Pollo ${tag}` }).returning({ id: ingredients.id })
    const [fajitas] = await db.insert(recipes).values({ name: `Fajitas ${tag}`, servings: 2, meals: ['dinner'] }).returning({ id: recipes.id })
    const [crema] = await db.insert(recipes).values({ name: `Crema ${tag}`, servings: 2, meals: ['lunch'] }).returning({ id: recipes.id })
    await db.insert(recipeIngredients).values({ recipeId: fajitas.id, ingredientId: pollo.id, quantity: 300, unit: 'g' } as any)

    // Sunday of this week: never in the past.
    const days: DayMenu[] = [{}, {}, {}, {}, {}, {}, {}]
    days[6] = {
      lunch: { dishes: [{ kind: 'recipe', recipeId: crema.id, recipeName: `Crema ${tag}`, course: null }] },
      dinner: { dishes: [{ kind: 'recipe', recipeId: fajitas.id, recipeName: `Fajitas ${tag}`, course: null }] },
    }
    const [m] = await db
      .insert(menus)
      .values({ userId: u.id, weekStart: madridWeekStart(), days, createdAt: new Date(Date.now() - 3_600_000) })
      .returning({ id: menus.id })

    // Unchanged: nothing to do.
    expect((await recheckSavedMenus({ recipeIds: [fajitas.id] })).changes).toEqual([])

    // Cocina adds wheat tortillas to the fajitas, and the crema is deleted.
    const [trigo] = await db.insert(ingredients).values({ name: `Tortillas de trigo ${tag}`, allergenTags: ['gluten'] }).returning({ id: ingredients.id })
    await db.insert(recipeIngredients).values({ recipeId: fajitas.id, ingredientId: trigo.id, quantity: 4, unit: 'u' } as any)
    await db.update(recipes).set({ allergens: ['gluten'], updatedAt: new Date() }).where(eq(recipes.id, fajitas.id))
    await db.delete(recipes).where(eq(recipes.id, crema.id))

    const result = await recheckSavedMenus({ recipeIds: [fajitas.id, crema.id] })
    expect(result.changes.filter((c) => c.menuId === m.id).map((c) => [c.meal, c.reason])).toEqual([
      ['dinner', 'diet'],
      ['lunch', 'removed'],
    ])

    const [saved] = await db.select({ days: menus.days }).from(menus).where(eq(menus.id, m.id))
    const sunday = (saved.days as DayMenu[])[6]
    for (const meal of ['lunch', 'dinner']) {
      const dish = sunday[meal]!.dishes[0]
      if (dish.kind === 'note') {
        expect(dish.text).toMatch(/elegid otro plato/)
        continue
      }
      expect([fajitas.id, crema.id]).not.toContain(dish.recipeId)
      expect((dish as RecipeDish).replaced?.reason).toBe(meal === 'dinner' ? 'diet' : 'removed')
      // What came in fits «sin gluten».
      const [r] = await db.select({ name: recipes.name, allergens: recipes.allergens }).from(recipes).where(eq(recipes.id, dish.recipeId))
      const lines = await db
        .select({ ingredientName: ingredients.name, allergenTags: ingredients.allergenTags, containsTags: ingredients.containsTags })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
        .where(eq(recipeIngredients.recipeId, dish.recipeId))
      expect(violatesRestrictions({ ...r, ingredients: lines }, compileRestrictions(['sin gluten']))).toBe(false)
    }

    // Done: a second pass changes nothing.
    expect((await recheckSavedMenus({ recipeIds: [fajitas.id, crema.id] })).changes).toEqual([])

    await db.delete(users).where(eq(users.id, u.id))
    await db.delete(recipes).where(eq(recipes.id, fajitas.id))
    await db.delete(ingredients).where(inArray(ingredients.id, [pollo.id, trigo.id]))
  })
})
