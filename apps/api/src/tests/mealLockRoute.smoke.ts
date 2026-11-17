/**
 * Smoke (PRO-1175, D-182 answer A): the lock only keeps a meal when the week
 * is redone, and what is chosen by hand locks it.
 *   - `PUT …/meal/:meal { recipeId }` and `POST …/dish` lock the meal;
 *   - a locked meal still changes: «Que elija Mimoia» (`PUT` without a
 *     recipe), drag and drop (the lock moves with it) and «Quitar» (the lock
 *     goes with it);
 *   - `{ dishType }` gives a recipe of that type, or 409 NO_RECIPE_OF_TYPE.
 * Requires SMOKE_USER_ID + SMOKE_USER_TOKEN (smoke orchestrator provides them).
 */
import { describe, it, expect } from 'vitest'
import { API_URL, TOKEN, USER_ID, authHeaders as auth, reachable } from './smokeEnv.js'

const ready = reachable && !!TOKEN && !!USER_ID
const SAT = 5

describe('meal lock and «Que elija Mimoia» (smoke)', () => {
  it.skipIf(!ready)('choosing by hand locks; a locked meal still changes, moves and goes', async () => {
    // Sixteen weeks back: a week no other smoke file uses.
    const monday = new Date()
    monday.setDate(monday.getDate() - 112 - ((monday.getDay() + 6) % 7))
    const weekStart = monday.toISOString().slice(0, 10)
    const gen = await fetch(`${API_URL}/menu/generate`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ userId: USER_ID, weekStart, empty: true, force: true }),
    })
    expect(gen.status).toBe(201)
    const menu = await gen.json()
    const recipes: Array<{ id: string; name: string }> = await (await fetch(`${API_URL}/recipes?perPage=100&fitsMe=1`, { headers: auth() })).json()
    expect(recipes.length).toBeGreaterThan(1)
    const slot = (day: number, meal: string) => `${API_URL}/menu/${menu.id}/day/${day}/meal/${meal}`
    const write = (method: string, url: string, body: unknown = {}) => fetch(url, { method, headers: auth(), body: JSON.stringify(body) })

    // A recipe picked by hand locks the Saturday dinner.
    const hasDinner = Boolean(menu.days[SAT]?.dinner)
    let r = await write(hasDinner ? 'PUT' : 'POST', slot(SAT, 'dinner'), { recipeId: recipes[0].id })
    expect([200, 201]).toContain(r.status)
    let m = await r.json()
    expect(m.locked?.[String(SAT)]?.dinner).toBe(true)

    // Locked, it still changes: Mimoia draws another and the lock stays.
    r = await write('PUT', slot(SAT, 'dinner'))
    expect(r.status).toBe(200)
    m = await r.json()
    expect(m.days[SAT].dinner.dishes[0].recipeId).not.toBe(recipes[0].id)
    expect(m.locked?.[String(SAT)]?.dinner).toBe(true)

    // A type with recipes → one of that type; a type the catalogue lacks → 409, nothing written.
    const typed: Array<{ id: string }> = await (await fetch(`${API_URL}/recipes?perPage=100&fitsMe=1&dishType=legumbres`, { headers: auth() })).json()
    if (typed.length > 0) {
      r = await write('PUT', slot(SAT, 'dinner'), { dishType: 'legumbres' })
      if (r.status === 200) expect(typed.map((t) => t.id)).toContain((await r.json()).days[SAT].dinner.dishes[0].recipeId)
      else expect(r.status).toBe(409)
    }
    const none: unknown[] = await (await fetch(`${API_URL}/recipes?perPage=100&fitsMe=1&dishType=carpaccio-tartar`, { headers: auth() })).json()
    if (none.length === 0) {
      const before = (await (await fetch(`${API_URL}/menu/${USER_ID}/${weekStart}`, { headers: auth() })).json()).days[SAT].dinner
      r = await write('PUT', slot(SAT, 'dinner'), { dishType: 'carpaccio-tartar' })
      expect(r.status).toBe(409)
      expect((await r.json()).code).toBe('NO_RECIPE_OF_TYPE')
      const after = (await (await fetch(`${API_URL}/menu/${USER_ID}/${weekStart}`, { headers: auth() })).json()).days[SAT].dinner
      expect(after).toEqual(before)
    }

    // Dragged to Sunday's lunch, the lock goes with it.
    r = await write('POST', `${API_URL}/menu/${menu.id}/move-slot`, { fromDay: SAT, fromMeal: 'dinner', toDay: 6, toMeal: 'lunch' })
    expect(r.status).toBe(200)
    m = await r.json()
    expect(m.locked?.['6']?.lunch).toBe(true)
    expect(m.locked?.[String(SAT)]?.dinner).toBeFalsy()

    // «Quitar» works on a locked meal and drops its lock.
    r = await fetch(slot(6, 'lunch'), { method: 'DELETE', headers: auth() })
    expect(r.status).toBe(200)
    m = await r.json()
    expect(m.days[6].lunch).toBeUndefined()
    expect(m.locked?.['6']?.lunch).toBeFalsy()

    // A dish added by hand locks its meal too.
    r = await write('POST', `${slot(4, 'lunch')}/dish`, { kind: 'note', text: 'Cenamos fuera' })
    expect(r.status).toBe(200)
    m = await (await fetch(`${API_URL}/menu/${USER_ID}/${weekStart}`, { headers: auth() })).json()
    expect(m.locked?.['4']?.lunch).toBe(true)
  }, 90_000)
})
