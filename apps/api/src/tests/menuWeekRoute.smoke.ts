/**
 * Smoke: a week's menu is never lost by accident (2026-10-07 data-loss fixes).
 *   - regenerating keeps locked slots (the route used to write `locked: {}`);
 *   - `empty: true` over a week with dishes is refused (409 MENU_NOT_EMPTY)
 *     unless `force: true` — the /menu page auto-creates an empty week and a
 *     failed GET used to make it wipe a real one;
 *   - "Vaciar semana" (force) still keeps locked slots.
 * Requires SMOKE_USER_ID + SMOKE_USER_TOKEN (smoke orchestrator provides them).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { API_URL, TOKEN, USER_ID, authHeaders as auth, reachable } from './smokeEnv.js'

const ready = reachable && !!TOKEN && !!USER_ID

describe('menu week data-loss guards (smoke)', () => {
  let weekStart = ''

  beforeAll(() => {
    // Three weeks back: doesn't collide with menusRoute.smoke.ts (two weeks back).
    const monday = new Date()
    monday.setDate(monday.getDate() - 21 - monday.getDay() + 1)
    weekStart = monday.toISOString().slice(0, 10)
  })

  const generate = (body: Record<string, unknown>) =>
    fetch(`${API_URL}/menu/generate`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ userId: USER_ID, weekStart, ...body }),
    })

  it.skipIf(!ready)(
    'locks survive regenerate and "Vaciar semana"; an unforced empty is refused',
    async () => {
      const first = await generate({})
      expect(first.status).toBe(201)
      const a = await first.json()
      // Lock the first filled slot of the week.
      let lockDay = -1
      let lockMeal = ''
      a.days.some((day: Record<string, { dishes?: unknown[] }>, i: number) =>
        Object.entries(day).some(([meal, slot]) => {
          if (slot?.dishes && slot.dishes.length > 0) {
            lockDay = i
            lockMeal = meal
            return true
          }
          return false
        }),
      )
      expect(lockDay).toBeGreaterThanOrEqual(0)
      const lockedSlot = a.days[lockDay][lockMeal]
      const lock = await fetch(`${API_URL}/menu/${a.id}/day/${lockDay}/meal/${lockMeal}/lock`, {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify({ locked: true }),
      })
      expect(lock.status).toBe(200)

      // The page's auto-create must not wipe a week that has dishes.
      const unforced = await generate({ empty: true })
      expect(unforced.status).toBe(409)
      expect((await unforced.json()).code).toBe('MENU_NOT_EMPTY')

      // Regenerate keeps the locked slot as it was.
      const regen = await generate({})
      expect(regen.status).toBe(201)
      const b = await regen.json()
      expect(b.locked?.[String(lockDay)]?.[lockMeal]).toBe(true)
      expect(b.days[lockDay][lockMeal].dishes.map((d: any) => d.recipeId)).toEqual(
        lockedSlot.dishes.map((d: any) => d.recipeId),
      )

      // "Vaciar semana" (user confirmed → force) empties everything but the lock.
      const cleared = await generate({ empty: true, force: true })
      expect(cleared.status).toBe(201)
      const c = await cleared.json()
      expect(c.days[lockDay][lockMeal].dishes.map((d: any) => d.recipeId)).toEqual(
        lockedSlot.dishes.map((d: any) => d.recipeId),
      )
      const otherDishes = c.days.flatMap((day: Record<string, { dishes?: unknown[] }>, i: number) =>
        Object.entries(day)
          .filter(([meal]) => !(i === lockDay && meal === lockMeal))
          .flatMap(([, slot]) => slot?.dishes ?? []),
      )
      expect(otherDishes).toEqual([])
    },
    120_000,
  )
})
