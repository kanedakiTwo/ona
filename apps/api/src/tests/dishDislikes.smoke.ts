/**
 * PRO-1142 against a running API + Postgres: a dislike that names a dish
 * hides it from «Elegir otra receta» (`?fitsMe=1`) even after a «Me apetece»,
 * and a «Me apetece» said after the dislike brings it back. The dates come
 * from the ficha's history and `recipe_verdicts`, as in the menu.
 * Registers its own throwaway user. Skips when the API isn't reachable.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { reachable } from './smokeEnv.js'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'

interface Session { token: string; userId: string }

async function register(): Promise<Session> {
  const username = `disgusto_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
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

describe.skipIf(!reachable)('a dislike that names a dish (smoke)', () => {
  let me: Session
  let dish: { id: string; name: string }
  const fitsMeIds = async () => {
    const ids = new Set<string>()
    for (let page = 1; page <= 20; page++) {
      const rows = (await call(me)('GET', `/recipes?perPage=100&page=${page}&fitsMe=1`)).json as Array<{ id: string }>
      rows.forEach((r) => ids.add(r.id))
      if (rows.length < 100) break
    }
    return ids
  }

  beforeAll(async () => {
    me = await register()
    const onboarding = { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'healthy' }
    expect((await call(me)('POST', `/user/${me.userId}/onboarding`, onboarding)).status).toBe(200)
    const list = (await call(me)('GET', '/recipes?perPage=100')).json as Array<{ id: string; name: string }>
    dish = list[0]
    expect(dish).toBeTruthy()
  })

  it('«Me apetece» first, the dislike after it: the dish is hidden', async () => {
    expect((await call(me)('POST', '/taste', { recipeId: dish.id, verdict: 'like' })).status).toBe(200)
    expect(await fitsMeIds()).toContain(dish.id)
    expect((await call(me)('PATCH', '/memory', { key: 'dislikes', value: [dish.name] })).status).toBe(200)
    expect(await fitsMeIds()).not.toContain(dish.id)
  })

  it('a «Me apetece» after the dislike brings it back', async () => {
    await new Promise((r) => setTimeout(r, 20))
    expect((await call(me)('POST', '/taste', { recipeId: dish.id, verdict: 'like' })).status).toBe(200)
    expect(await fitsMeIds()).toContain(dish.id)
  })
})
