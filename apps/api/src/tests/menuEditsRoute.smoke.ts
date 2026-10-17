/**
 * Smoke (real API + Postgres) for PRO-149 · Registro de cambios del menú:
 * every route that changes which recipes a menu holds leaves its row with the
 * recipe before and after, generating the menu leaves none, and a call made
 * like Mimo's (loopback header + channel) is recorded as `mimo`.
 *
 *   API_URL=… pnpm --filter @ona/api exec vitest run src/tests/menuEditsRoute.smoke.ts
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { API_URL, reachable } from './smokeEnv.js'

const tag = `me${Date.now()}${Math.random().toString(36).slice(2, 6)}`
let token = ''
let userId = ''
let menuId = ''
let days: Array<Record<string, { dishes: Array<{ kind: string; recipeId?: string; recipeName?: string }> }>> = []

async function call(method: string, path: string, payload?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

const edits = async () => (await call('GET', `/menu/${menuId}/edits`)).body as Array<Record<string, any>>
const recipeIdsOf = (d: number, meal: string) =>
  (days[d]?.[meal]?.dishes ?? []).filter((x) => x.kind === 'recipe').map((x) => x.recipeId as string)

describe.skipIf(!reachable)('menu change log (PRO-149)', () => {
  beforeAll(async () => {
    const reg = await call('POST', '/register', { username: tag, email: `${tag}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status, JSON.stringify(reg.body)).toBe(201)
    token = reg.body.token
    userId = reg.body.user.id
    await call('POST', `/user/${userId}/onboarding`, {
      householdSize: 'solo', cookingFreq: '3_4_times', restrictions: [], favoriteDishes: ['pasta'], priority: 'healthy',
    })
    const monday = new Date()
    monday.setDate(monday.getDate() - 21 - ((monday.getDay() + 6) % 7))
    const gen = await call('POST', '/menu/generate', { userId, weekStart: monday.toISOString().slice(0, 10) })
    expect(gen.status, JSON.stringify(gen.body)).toBeLessThan(300)
    menuId = gen.body.id ?? gen.body.menu?.id
    days = gen.body.days ?? gen.body.menu?.days
  }, 90_000)

  it('generating the menu is not an edit', async () => {
    expect(await edits()).toEqual([])
  })

  it('each change leaves its row, with before/after, and Mimo is marked as such', async () => {
    // Two different recipes from the generated week to play with.
    const lunch0 = recipeIdsOf(0, 'lunch')[0]
    const other = recipeIdsOf(1, 'lunch')[0] ?? recipeIdsOf(1, 'dinner')[0]
    expect(lunch0 && other && lunch0 !== other).toBeTruthy()

    // swap (picked by the user)
    expect((await call('PUT', `/menu/${menuId}/day/0/meal/lunch`, { recipeId: other })).status).toBe(200)
    // swap again, as Mimo on WhatsApp would (appApi.ts headers)
    expect((await call('PUT', `/menu/${menuId}/day/0/meal/lunch`, { recipeId: lunch0 }, { 'x-mimoia-internal': '1', 'x-mimoia-channel': 'whatsapp' })).status).toBe(200)
    // remove the dish, then add one back (random) and a freezer táper
    expect((await call('DELETE', `/menu/${menuId}/day/0/meal/lunch/dish/0`)).status).toBe(200)
    expect((await call('POST', `/menu/${menuId}/day/0/meal/lunch/dish/random`)).status).toBe(200)
    expect((await call('POST', `/menu/${menuId}/day/0/meal/lunch/dish`, { kind: 'recipe', recipeId: other, variant: 'freezer' })).status).toBe(200)
    // veto for the week
    expect((await call('POST', `/menu/${menuId}/ban`, { recipeId: other })).status).toBe(200)
    // clear a slot and fill it with leftovers of Tuesday's lunch
    expect((await call('DELETE', `/menu/${menuId}/day/2/meal/dinner`)).status).toBe(200)
    expect((await call('POST', `/menu/${menuId}/day/2/leftover`, { sourceDay: 1, sourceMeal: 'lunch', targetMeal: 'dinner' })).status).toBe(201)
    // move Thursday's lunch onto Friday's lunch (swap of slots)
    expect((await call('POST', `/menu/${menuId}/move-slot`, { fromDay: 3, fromMeal: 'lunch', toDay: 4, toMeal: 'lunch' })).status).toBe(200)
    // Sunday: no cooking
    expect((await call('POST', `/menu/${menuId}/day/6/skip`)).status).toBe(200)

    const rows = await edits()
    const byAction = (a: string) => rows.filter((r) => r.action === a)

    const swaps = byAction('swap')
    expect(swaps).toHaveLength(2)
    expect(swaps[0]).toMatchObject({ day: 0, meal: 'lunch', beforeRecipeId: lunch0, afterRecipeId: other, actor: 'user', channel: 'web' })
    expect(swaps[0].beforeRecipeName).toBeTruthy()
    expect(swaps[0].afterRecipeName).toBeTruthy()
    expect(swaps[1]).toMatchObject({ beforeRecipeId: other, afterRecipeId: lunch0, actor: 'mimo', channel: 'whatsapp' })

    expect(byAction('remove').some((r) => r.day === 0 && r.beforeRecipeId === lunch0)).toBe(true)
    expect(byAction('remove').some((r) => r.day === 2 && r.meal === 'dinner')).toBe(true)
    expect(byAction('add')).toHaveLength(1)
    expect(byAction('add')[0].afterRecipeId).toBeTruthy()
    expect(byAction('freezer')[0]).toMatchObject({ day: 0, meal: 'lunch', afterRecipeId: other })
    expect(byAction('freezer')[0].afterRecipeName).toBeTruthy()
    expect(byAction('ban')[0]).toMatchObject({ day: null, beforeRecipeId: other })
    expect(byAction('ban')[0].beforeRecipeName).toBeTruthy()
    expect(byAction('leftover')[0]).toMatchObject({ day: 2, meal: 'dinner', fromDay: 1, fromMeal: 'lunch', afterRecipeId: recipeIdsOf(1, 'lunch')[0] })
    expect(byAction('move').length).toBeGreaterThanOrEqual(1)
    expect(byAction('move')[0]).toMatchObject({ day: 4, meal: 'lunch', fromDay: 3, fromMeal: 'lunch', afterRecipeId: recipeIdsOf(3, 'lunch')[0] })
    expect(byAction('skip_day').length).toBeGreaterThanOrEqual(1)
    expect(byAction('skip_day').every((r) => r.day === 6)).toBe(true)
    // Every row is tied to the household.
    expect(rows.every((r) => r.householdId && r.menuId === menuId && r.userId === userId)).toBe(true)
  }, 90_000)

  it('another account cannot read the log', async () => {
    const own = token
    const reg = await call('POST', '/register', { username: `${tag}x`, email: `${tag}x@test.local`, password: 'smokepass123', ageConfirmed: true })
    token = reg.body.token
    expect((await call('GET', `/menu/${menuId}/edits`)).status).toBe(403)
    token = own
  })
})
