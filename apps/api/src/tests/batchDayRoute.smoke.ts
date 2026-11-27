/**
 * Smoke (real API + Postgres), PRO-1046 · el día de lote:
 * `PATCH /menu/:menuId/day/:day/meal/:meal/dish/:position { batchDate }`
 * saves «se cocina en el lote del domingo» on a recipe cooked for that meal,
 * 1 to 6 days before it (the Sunday before the week included); refuses a
 * leftover, a táper, the same day and a week before; a leftover made later
 * doesn't copy it; marking the dish «ya hecho» drops it. (The list buying
 * it: batchDay.test.ts.)
 *
 *   API_URL=… pnpm --filter @ona/api exec vitest run src/tests/batchDayRoute.smoke.ts
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { addDaysIso } from '@ona/shared'
import { API_URL, reachable } from './smokeEnv.js'

const tag = `bd${Date.now()}${Math.random().toString(36).slice(2, 6)}`
let token = ''
let userId = ''
let menuId = ''
let weekStart = ''
let recipeId = ''

async function call(method: string, path: string, payload?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

const week = async () => (await call('GET', `/menu/${userId}/${weekStart}`)).body
const mondayLunch = async () => (await week()).days[0].lunch.dishes[0]
const patchMonday = (body: Record<string, unknown>) => call('PATCH', `/menu/${menuId}/day/0/meal/lunch/dish/0`, body)

describe.skipIf(!reachable)('PRO-1046 · a dish cooked in the Sunday batch', () => {
  beforeAll(async () => {
    const reg = await call('POST', '/register', { username: tag, email: `${tag}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status, JSON.stringify(reg.body)).toBe(201)
    token = reg.body.token
    userId = reg.body.user.id
    await call('POST', `/user/${userId}/onboarding`, {
      householdSize: 'solo', cookingFreq: '3_4_times', restrictions: [], favoriteDishes: ['pasta'], priority: 'healthy',
    })
    // Two weeks ahead: nothing of it is past.
    const monday = new Date()
    monday.setDate(monday.getDate() + 14 - ((monday.getDay() + 6) % 7))
    weekStart = monday.toISOString().slice(0, 10)
    const customTemplate = Array.from({ length: 7 }, () => ({ lunch: true, dinner: true }))
    const gen = await call('POST', '/menu/generate', { userId, weekStart, customTemplate })
    expect(gen.status, JSON.stringify(gen.body)).toBeLessThan(300)
    menuId = gen.body.id ?? gen.body.menu?.id
    const recipes = (await call('GET', '/recipes?perPage=5')).body as Array<{ id: string }>
    recipeId = recipes[0].id
    await call('DELETE', `/menu/${menuId}/day/0/meal/lunch`)
    expect((await call('POST', `/menu/${menuId}/day/0/meal/lunch`, { recipeId })).status).toBeLessThan(300)
  }, 90_000)

  it('the Sunday before: saved; the same day, after or a week before: 400', async () => {
    const sunday = addDaysIso(weekStart, -1)
    for (const bad of [weekStart, addDaysIso(weekStart, 1), addDaysIso(weekStart, -7)]) {
      const r = await patchMonday({ batchDate: bad })
      expect(r.status, bad).toBe(400)
    }
    expect((await patchMonday({ batchDate: 'domingo' })).status).toBe(400)
    const ok = await patchMonday({ batchDate: sunday })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(await mondayLunch()).toMatchObject({ kind: 'recipe', recipeId, batchDate: sunday })
  })

  it('its leftovers don\'t copy it and can\'t be batched', async () => {
    await call('DELETE', `/menu/${menuId}/day/1/meal/lunch`)
    const lo = await call('POST', `/menu/${menuId}/day/1/leftover`, { sourceDay: 0, sourceMeal: 'lunch', targetMeal: 'lunch' })
    expect(lo.status, JSON.stringify(lo.body)).toBeLessThan(300)
    const tuesday = (await week()).days[1].lunch.dishes[0]
    expect(tuesday).toMatchObject({ variant: 'leftover' })
    expect(tuesday.batchDate ?? null).toBeNull()
    const r = await call('PATCH', `/menu/${menuId}/day/1/meal/lunch/dish/0`, { batchDate: addDaysIso(weekStart, -1) })
    expect(r.status).toBe(400)
  })

  it('«Lo cocino su día» clears it; «ya hecho» on a batched dish drops it too', async () => {
    expect((await patchMonday({ batchDate: null })).status).toBe(200)
    expect((await mondayLunch()).batchDate ?? null).toBeNull()
    // A fresh dish with no leftovers to test «ya hecho».
    await call('DELETE', `/menu/${menuId}/day/2/meal/dinner`)
    expect((await call('POST', `/menu/${menuId}/day/2/meal/dinner`, { recipeId })).status).toBeLessThan(300)
    const path = `/menu/${menuId}/day/2/meal/dinner/dish/0`
    expect((await call('PATCH', path, { batchDate: addDaysIso(weekStart, 1) })).status).toBe(200)
    expect((await call('PATCH', path, { variant: 'cooked' })).status).toBe(200)
    const dish = (await week()).days[2].dinner.dishes[0]
    expect(dish.variant).toBe('cooked')
    expect(dish.batchDate ?? null).toBeNull()
    // A táper can't go in a batch.
    expect((await call('PATCH', path, { batchDate: addDaysIso(weekStart, 1) })).status).toBe(400)
  })
})
