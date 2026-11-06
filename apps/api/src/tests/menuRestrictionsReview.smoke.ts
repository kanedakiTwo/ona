/**
 * PRO-364 (Seguridad) against a running API + Postgres: a household with
 * «Pizza» in the saved menu saves «sin gluten» afterwards and the menu from
 * today on no longer has gluten (or carries the warning), by the profile
 * (`PUT /user/:id`) and by the memory Mimo writes (`setMemoryBatch`, the same
 * store `PATCH /memory` uses) and, since PRO-1067, by the ficha del hogar
 * (`POST /household/profile/facts`). Days already past are not touched.
 * PRO-1067: the new dish says «En lugar de …», and a pizza picked again by
 * hand stays when the next save brings a rule it doesn't break.
 * Registers its own throwaway users. Skips when the API isn't reachable.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { reachable } from './smokeEnv.js'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'

interface Session { token: string; userId: string }
type Slot = { dishes?: Array<{ kind: string; recipeId?: string; restrictionConflict?: boolean }> }

async function register(prefix: string): Promise<Session> {
  const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const username = `${prefix}_${id}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@test.local`, password: 'smokepass123', ageConfirmed: true }),
  })
  const body = await r.json()
  return { token: body.token, userId: body.user.id }
}

function call(s: Session) {
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    return { status: r.status, json: text ? JSON.parse(text) : null }
  }
}

const onboarding = { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'healthy' }

/** Monday (YYYY-MM-DD, Madrid) of this week + `weeks`, and today's index 0-6. */
function madridWeek(weeks: number): { weekStart: string; todayIndex: number } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const d = new Date(`${today}T12:00:00Z`)
  const todayIndex = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - todayIndex + weeks * 7)
  return { weekStart: d.toISOString().slice(0, 10), todayIndex }
}

/** Put the recipe in the slot: «Elegir otra receta» (PUT), or add the meal when the day doesn't have it (POST). */
async function place(api: ReturnType<typeof call>, menuId: string, day: number, meal: string, recipeId: string) {
  const put = await api('PUT', `/menu/${menuId}/day/${day}/meal/${meal}`, { recipeId })
  if (put.status === 404 && put.json?.error === 'Slot not found') {
    const add = await api('POST', `/menu/${menuId}/day/${day}/meal/${meal}`, { recipeId })
    expect(add.status, JSON.stringify(add.json)).toBe(201)
    return
  }
  expect(put.status, JSON.stringify(put.json)).toBe(200)
}

/** A household with a gluten pizza on next Saturday's lunch (and on this Monday's, when it has passed). */
async function householdWithPizza(prefix: string) {
  const user = await register(prefix)
  const api = call(user)
  expect((await api('POST', `/user/${user.userId}/onboarding`, onboarding)).status).toBe(200)
  expect((await api('POST', `/user/${user.userId}/health-consent`, { consent: true })).status).toBe(200)
  const flour = await api('POST', '/ingredients/auto-create', { name: 'harina de trigo' })
  expect(flour.status).toBeLessThan(300)
  const pizza = await api('POST', '/recipes', {
    name: 'Pizza margarita (smoke)',
    servings: 2,
    meals: ['lunch', 'dinner'],
    equipment: ['horno'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    ingredients: [{ ingredientId: flour.json.ingredient.id, quantity: 250, unit: 'g' }],
    steps: [{ index: 0, text: 'Amasa la harina de trigo y hornea la pizza.' }],
    force: true,
  })
  expect(pizza.status, JSON.stringify(pizza.json)).toBe(201)

  const next = madridWeek(1)
  const gen = await api('POST', '/menu/generate', { userId: user.userId, weekStart: next.weekStart })
  expect(gen.status).toBe(201)
  await place(api, gen.json.id, 5, 'lunch', pizza.json.id)

  // This week's Monday, when today isn't Monday: already past.
  const cur = madridWeek(0)
  let pastMenuId: string | null = null
  if (cur.todayIndex > 0) {
    const genCur = await api('POST', '/menu/generate', { userId: user.userId, weekStart: cur.weekStart })
    expect(genCur.status).toBe(201)
    pastMenuId = genCur.json.id
    await place(api, pastMenuId!, 0, 'lunch', pizza.json.id)
  }
  return { user, api, pizzaId: pizza.json.id as string, next, cur, pastMenuId }
}

/** What fits the user now, as the «Elegir otra receta» picker computes it. */
async function fitting(api: ReturnType<typeof call>): Promise<Set<string>> {
  const ok = new Set<string>()
  for (let page = 1; page <= 20; page++) {
    const fits = (await api('GET', `/recipes?perPage=100&page=${page}&fitsMe=1`)).json as Array<{ id: string }>
    for (const r of fits) ok.add(r.id)
    if (fits.length < 100) break
  }
  return ok
}

async function expectSaturdayWithoutGluten(h: Awaited<ReturnType<typeof householdWithPizza>>) {
  const ok = await fitting(h.api)
  expect(ok.has(h.pizzaId)).toBe(false)
  const menu = (await h.api('GET', `/menu/${h.user.userId}/${h.next.weekStart}`)).json
  const saturday = (menu.days[5].lunch as Slot).dishes ?? []
  expect(saturday.some((d) => d.recipeId === h.pizzaId && !d.restrictionConflict)).toBe(false)
  // Every dish of next week fits, or says it doesn't.
  for (const day of menu.days) {
    for (const slot of Object.values(day ?? {}) as Slot[]) {
      for (const d of slot?.dishes ?? []) {
        if (d.kind === 'recipe' && d.recipeId) expect(ok.has(d.recipeId) || d.restrictionConflict === true, d.recipeId).toBe(true)
      }
    }
  }
  if (h.pastMenuId) {
    const cur = (await h.api('GET', `/menu/${h.user.userId}/${h.cur.weekStart}`)).json
    const monday = (cur.days[0].lunch as Slot).dishes ?? []
    expect(monday.map((d) => d.recipeId)).toContain(h.pizzaId)
    expect(monday.some((d) => d.restrictionConflict)).toBe(false)
  }
}

describe.skipIf(!reachable)('saved menus after saving allergies (smoke)', () => {
  let profile: Awaited<ReturnType<typeof householdWithPizza>>
  let mimo: Awaited<ReturnType<typeof householdWithPizza>>
  let ficha: Awaited<ReturnType<typeof householdWithPizza>>
  beforeAll(async () => {
    profile = await householdWithPizza('celiaco')
    mimo = await householdWithPizza('celiacomimo')
    ficha = await householdWithPizza('celiacoficha')
  }, 180_000)

  it('«sin gluten» saved in the profile: Saturday has no gluten, past days untouched', async () => {
    const put = await profile.api('PUT', `/user/${profile.user.userId}`, { restrictions: ['sin gluten'] })
    expect(put.status).toBe(200)
    await expectSaturdayWithoutGluten(profile)
    // PRO-1067: the card says what was there.
    const menu = (await profile.api('GET', `/menu/${profile.user.userId}/${profile.next.weekStart}`)).json
    const saturday = (menu.days[5].lunch.dishes ?? []) as Array<{ recipeId?: string; restrictionConflict?: boolean; replaced?: { recipeName: string; reason: string } }>
    const swapped = saturday.find((d) => d.replaced?.reason === 'restrictions')
    if (!saturday.some((d) => d.restrictionConflict)) expect(swapped?.replaced?.recipeName).toBe('Pizza margarita (smoke)')
  }, 90_000)

  it('PRO-1067: the pizza picked again by hand stays when an unrelated rule is saved', async () => {
    const menu = (await profile.api('GET', `/menu/${profile.user.userId}/${profile.next.weekStart}`)).json
    await place(profile.api, menu.id, 5, 'lunch', profile.pizzaId)
    const put = await profile.api('PUT', `/user/${profile.user.userId}`, { restrictions: ['sin gluten', 'sin lactosa'] })
    expect(put.status).toBe(200)
    const after = (await profile.api('GET', `/menu/${profile.user.userId}/${profile.next.weekStart}`)).json
    expect(((after.days[5].lunch as Slot).dishes ?? []).map((d) => d.recipeId)).toContain(profile.pizzaId)
  }, 90_000)

  it('PRO-1067: «sin gluten» written in the ficha del hogar: the same', async () => {
    const fact = await ficha.api('POST', '/household/profile/facts', { type: 'restrictions', value: ['sin gluten'], about: 'me' })
    expect(fact.status, JSON.stringify(fact.json)).toBe(201)
    await expectSaturdayWithoutGluten(ficha)
  }, 90_000)

  it('«sin gluten» saved in the memory (what Mimo writes): the same', async () => {
    const patch = await mimo.api('PATCH', '/memory', { facts: [{ key: 'restrictions', value: ['sin gluten'] }] })
    expect(patch.status, JSON.stringify(patch.json)).toBe(200)
    await expectSaturdayWithoutGluten(mimo)
  }, 90_000)
})
