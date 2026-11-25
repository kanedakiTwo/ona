/**
 * PRO-1296 · The web sign-up's first menu brings the dishes they make often,
 * as the WhatsApp sign-up does: three catalogue dishes said in the sign-up
 * are in the first week, and the second week (Friday to Sunday the sign-up
 * makes two) doesn't repeat them. Against a running API + Postgres.
 *
 *   API_URL=http://localhost:8765 DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/webSignupDishes.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu } from '@ona/shared'
import { API_URL, reachable } from './smokeEnv.js'
import { signupDishesForWeek } from '../services/menuGenerate.js'

async function call(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: r.status, body }
}

function monday(offsetWeeks: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 * offsetWeeks)
  return d.toISOString().slice(0, 10)
}

const recipeIdsOf = (days: DayMenu[]) =>
  days.flatMap((day) => Object.values(day ?? {}).flatMap((slot) => (slot?.dishes ?? []).flatMap((d) => (d.kind === 'recipe' ? [d.recipeId] : []))))

describe.skipIf(!reachable)('alta de la web: sus platos en el primer menú (PRO-1296)', () => {
  it('three catalogue dishes said in the sign-up are in the first menu, not forced again in the second week', { timeout: 120_000 }, async () => {
    const u = `altaweb_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const auth = { Authorization: `Bearer ${reg.body.token}` }
    const userId = reg.body.user.id as string

    // Three dinners of the catalogue, said by their name.
    const list = await call('GET', '/recipes?fitsMe=1', undefined, auth)
    expect(list.status).toBe(200)
    const recipes: any[] = Array.isArray(list.body) ? list.body : list.body.recipes ?? list.body.items ?? []
    const names = new Set<string>()
    const picked = recipes
      .filter((r) => (r.meals ?? []).includes('dinner') && r.course !== 'dessert' && !(r.tags ?? []).includes('postre'))
      // A name no other recipe contains, so the dish is that recipe.
      .filter((r) => !recipes.some((o) => o.id !== r.id && o.name.toLowerCase().includes(r.name.toLowerCase())))
      .filter((r) => !names.has(r.name) && names.add(r.name))
      .slice(0, 3)
    expect(picked).toHaveLength(3)

    const onb = await call('POST', `/user/${userId}/onboarding`, {
      adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'varied',
      favoriteDishes: picked.map((r) => r.name),
    }, auth)
    expect(onb.status).toBe(200)

    // The sign-up's first menu (OnboardingFlow: `fromDate`), a whole week from Monday.
    const fromDate = monday(1)
    const first = await call('POST', '/menu/generate', { userId, weekStart: monday(1), fromDate }, auth)
    expect(first.status).toBe(201)
    const firstIds = recipeIdsOf(first.body.days)
    for (const r of picked) expect(firstIds, `«${r.name}» en el primer menú`).toContain(r.id)

    // The second week of the sign-up doesn't put them again (they're in the first).
    expect(await signupDishesForWeek(userId, null, monday(2), fromDate)).toEqual([])
    expect((await call('POST', '/menu/generate', { userId, weekStart: monday(2), fromDate }, auth)).status).toBe(201)

    // A household with weeks before isn't signing up: nothing is placed.
    expect(await signupDishesForWeek(userId, null, monday(4), monday(4))).toEqual([])
  })

  it('the web sign-up asks no dishes since PRO-146: three «Me encanta» of «Afina tu menú» are in the first menu', { timeout: 120_000 }, async () => {
    const u = `altawebme_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const auth = { Authorization: `Bearer ${reg.body.token}` }
    const userId = reg.body.user.id as string

    const list = await call('GET', '/recipes?fitsMe=1', undefined, auth)
    const recipes: any[] = Array.isArray(list.body) ? list.body : list.body.recipes ?? list.body.items ?? []
    const loved = recipes.filter((r) => (r.meals ?? []).includes('dinner') && r.course !== 'dessert').slice(-3)
    expect(loved).toHaveLength(3)
    for (const r of loved) expect((await call('POST', '/taste', { recipeId: r.id, verdict: 'love' }, auth)).status).toBeLessThan(300)

    expect((await call('POST', `/user/${userId}/onboarding`, { adults: 1, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'varied' }, auth)).status).toBe(200)
    const first = await call('POST', '/menu/generate', { userId, weekStart: monday(1), fromDate: monday(1) }, auth)
    expect(first.status).toBe(201)
    const ids = recipeIdsOf(first.body.days)
    for (const r of loved) expect(ids, `«${r.name}» en el primer menú`).toContain(r.id)
  })
})
