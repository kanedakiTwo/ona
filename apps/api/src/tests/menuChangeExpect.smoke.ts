/**
 * Smoke (real API + Postgres), 2026-11-10 review of the menu's change queue:
 *   - a change by position carries what it expects to find (`expect`,
 *     `expectFrom` / `expectTo`: `dishKey` / `slotKey` of `@ona/shared`); when
 *     the week doesn't have it there the route answers 409 MENU_CHANGED and
 *     writes nothing. Lunch [Lentejas, Romanescu, Pan]: «Quitar Pan» sent as
 *     position 1 after «Quitar Romanescu» failed must not remove Romanescu;
 *   - «Usar "…" como plato» is one `PUT …/meal/:meal { note }` that replaces
 *     the dishes and keeps «Solo hoy» (it was DELETE + POST + PATCH).
 *
 *   API_URL=… pnpm --filter @ona/api exec vitest run src/tests/menuChangeExpect.smoke.ts
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { dishKey, slotKey } from '@ona/shared'
import { API_URL, reachable } from './smokeEnv.js'

const tag = `mx${Date.now()}${Math.random().toString(36).slice(2, 6)}`
let token = ''
let userId = ''
let menuId = ''
let weekStart = ''

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
const names = (slot: { dishes?: Array<{ kind: string; recipeName?: string; text?: string }> } | undefined) =>
  (slot?.dishes ?? []).map((d) => (d.kind === 'recipe' ? 'receta' : d.text))

describe.skipIf(!reachable)('menu changes by position check what they expect', () => {
  beforeAll(async () => {
    const reg = await call('POST', '/register', { username: tag, email: `${tag}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status, JSON.stringify(reg.body)).toBe(201)
    token = reg.body.token
    userId = reg.body.user.id
    await call('POST', `/user/${userId}/onboarding`, {
      householdSize: 'solo', cookingFreq: '3_4_times', restrictions: [], favoriteDishes: ['pasta'], priority: 'healthy',
    })
    const monday = new Date()
    monday.setDate(monday.getDate() - 28 - ((monday.getDay() + 6) % 7))
    weekStart = monday.toISOString().slice(0, 10)
    const customTemplate = Array.from({ length: 7 }, () => ({ lunch: true, dinner: true }))
    const gen = await call('POST', '/menu/generate', { userId, weekStart, customTemplate })
    expect(gen.status, JSON.stringify(gen.body)).toBeLessThan(300)
    menuId = gen.body.id ?? gen.body.menu?.id
    // Monday's lunch: one recipe + «Romanescu» + «Pan»; «Solo hoy: 3».
    const recipes = (await call('GET', '/recipes?perPage=5')).body as Array<{ id: string }>
    await call('DELETE', `/menu/${menuId}/day/0/meal/lunch`)
    expect((await call('POST', `/menu/${menuId}/day/0/meal/lunch`, { recipeId: recipes[0].id })).status).toBeLessThan(300)
    for (const text of ['Romanescu', 'Pan']) {
      expect((await call('POST', `/menu/${menuId}/day/0/meal/lunch/dish`, { kind: 'note', text })).status).toBe(200)
    }
    expect((await call('PATCH', `/menu/${menuId}/day/0/meal/lunch`, { servings: 3 })).status).toBe(200)
  }, 90_000)

  it('«Quitar Pan» sent as position 1 while Romanescu is still there: 409, nothing removed', async () => {
    const pan = dishKey({ kind: 'note', text: 'Pan' })
    const r = await call('DELETE', `/menu/${menuId}/day/0/meal/lunch/dish/1?expect=${encodeURIComponent(pan)}`)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('MENU_CHANGED')
    expect(names((await week()).days[0].lunch)).toEqual(['receta', 'Romanescu', 'Pan'])
    // A note edited by position checks it too.
    const patch = await call('PATCH', `/menu/${menuId}/day/0/meal/lunch/dish/1`, { text: 'Pan de pueblo', expect: pan })
    expect(patch.status).toBe(409)
    // With the right dish it goes through.
    const ok = await call('DELETE', `/menu/${menuId}/day/0/meal/lunch/dish/2?expect=${encodeURIComponent(pan)}`)
    expect(ok.status).toBe(200)
    expect(names((await week()).days[0].lunch)).toEqual(['receta', 'Romanescu'])
  })

  it('a move or a «Quitar comida» onto a meal that isn\'t what was seen: 409', async () => {
    const w = await week()
    const move = await call('POST', `/menu/${menuId}/move-slot`, {
      fromDay: 1, fromMeal: 'lunch', toDay: 2, toMeal: 'lunch',
      expectFrom: slotKey(w.days[1].lunch), expectTo: '∅',
    })
    expect(move.status).toBe(409)
    const del = await call('DELETE', `/menu/${menuId}/day/2/meal/lunch?expect=${encodeURIComponent(slotKey(w.days[3].lunch))}`)
    expect(del.status).toBe(409)
    expect(slotKey((await week()).days[2].lunch)).toBe(slotKey(w.days[2].lunch))
    // With what was seen it goes through; without `expect` (Mimo, an older app) nothing is checked.
    const seen = await call('DELETE', `/menu/${menuId}/day/2/meal/lunch?expect=${encodeURIComponent(slotKey(w.days[2].lunch))}`)
    expect(seen.status).toBe(200)
    expect((await call('DELETE', `/menu/${menuId}/day/3/meal/lunch`)).status).toBe(200)
  })

  it('«Usar "…" como plato» is one PUT: the dishes become the note and «Solo hoy» stays', async () => {
    const r = await call('PUT', `/menu/${menuId}/day/0/meal/lunch`, { note: 'Cenamos fuera' })
    expect(r.status).toBe(200)
    const lunch = (await week()).days[0].lunch
    expect(names(lunch)).toEqual(['Cenamos fuera'])
    expect(lunch.servings).toBe(3)
  })
})
