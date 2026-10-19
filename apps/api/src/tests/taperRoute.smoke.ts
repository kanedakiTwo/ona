/**
 * Smoke (PRO-223): `POST/DELETE /menu/:menuId/day/:day/meal/:meal/taper`.
 * Requires SMOKE_USER_ID + SMOKE_USER_TOKEN (smoke orchestrator provides them).
 */
import { describe, it, expect } from 'vitest'
import { API_URL, TOKEN, USER_ID, authHeaders as auth, reachable } from './smokeEnv.js'

const ready = reachable && !!TOKEN && !!USER_ID

describe('táper route (smoke)', () => {
  it.skipIf(!ready)('Tuesday lunch becomes Monday dinner’s táper and back; Monday is refused', async () => {
    // Ten weeks back: a week no other smoke file uses.
    const monday = new Date()
    monday.setDate(monday.getDate() - 70 - ((monday.getDay() + 6) % 7))
    const weekStart = monday.toISOString().slice(0, 10)
    const gen = await fetch(`${API_URL}/menu/generate`, { method: 'POST', headers: auth(), body: JSON.stringify({ userId: USER_ID, weekStart }) })
    expect(gen.status).toBe(201)
    const menu = await gen.json()
    const dinner = menu.days[0].dinner.dishes.find((d: any) => d.kind === 'recipe')

    const r = await fetch(`${API_URL}/menu/${menu.id}/day/1/meal/lunch/taper`, { method: 'POST', headers: auth(), body: JSON.stringify({}) })
    expect(r.status).toBe(201)
    const m = await r.json()
    expect(m.days[1].lunch).toMatchObject({ taper: 1, servings: 1 })
    expect(m.days[1].lunch.dishes[0]).toMatchObject({ recipeId: dinner.recipeId, variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner' } })
    expect(m.days[0].dinner.dishes[0].recipeId).toBe(dinner.recipeId)

    expect((await fetch(`${API_URL}/menu/${menu.id}/day/0/meal/lunch/taper`, { method: 'POST', headers: auth(), body: '{}' })).status).toBe(409)
    expect((await fetch(`${API_URL}/menu/${menu.id}/day/1/meal/lunch/taper`, { method: 'POST', headers: auth(), body: JSON.stringify({ count: 9 }) })).status).toBe(400)

    const del = await fetch(`${API_URL}/menu/${menu.id}/day/1/meal/lunch/taper`, { method: 'DELETE', headers: auth() })
    expect(del.status).toBe(200)
    expect((await del.json()).days[1].lunch).toEqual({ dishes: [] })
  }, 60_000)
})
