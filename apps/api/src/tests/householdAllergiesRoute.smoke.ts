/**
 * PRO-271 (Seguridad) against a running API + Postgres: someone who joins a
 * household by invitation and says «marisco» is taken into account
 *   - by `GET /households/me/allergies` («no ha contestado» vs «ninguna»), and
 *   - by the owner's «Generar mi menú» (every member's restrictions).
 * Registers its own throwaway users. Skips when the API isn't reachable.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { reachable } from './smokeEnv.js'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'

interface Session { token: string; userId: string; username: string }

async function register(prefix: string): Promise<Session> {
  const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const username = `${prefix}_${id}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@test.local`, password: 'smokepass123', ageConfirmed: true }),
  })
  const body = await r.json()
  return { token: body.token, userId: body.user.id, username }
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

describe.skipIf(!reachable)('allergies when joining a household (smoke)', () => {
  let owner: Session
  let guest: Session
  beforeAll(async () => {
    owner = await register('casa')
    guest = await register('invit')
    expect((await call(owner)('POST', `/user/${owner.userId}/onboarding`, onboarding)).status).toBe(200)
  })

  it('nobody has answered: the owner is asked', async () => {
    const s = (await call(owner)('GET', '/households/me/allergies')).json
    expect(s).toEqual({ meAnswered: false, pending: [], anyAnswered: false })
  })

  it('the invited person says «marisco»: answered for them, the owner still pending', async () => {
    const inv = await call(owner)('POST', '/households/me/invites', { role: 'member' })
    expect(inv.status).toBe(201)
    const api = call(guest)
    expect((await api('POST', `/invites/${inv.json.token}/accept`)).status).toBe(200)
    expect((await api('GET', '/households/me/allergies')).json).toEqual({ meAnswered: false, pending: [owner.username], anyAnswered: false })

    expect((await api('POST', `/user/${guest.userId}/health-consent`, { consent: true })).status).toBe(200)
    expect((await api('PUT', `/user/${guest.userId}`, { restrictions: ['marisco'] })).status).toBe(200)
    expect((await api('GET', '/households/me/allergies')).json).toEqual({ meAnswered: true, pending: [owner.username], anyAnswered: true })
    expect((await call(owner)('GET', '/households/me/allergies')).json).toEqual({ meAnswered: false, pending: [], anyAnswered: true })
  })

  it('«ninguna» (consent, nothing saved) counts as answered', async () => {
    const api = call(owner)
    expect((await api('POST', `/user/${owner.userId}/health-consent`, { consent: true })).status).toBe(200)
    expect((await api('GET', '/households/me/allergies')).json).toEqual({ meAnswered: true, pending: [], anyAnswered: true })
  })

  it('the owner’s weekly menu has nothing the invited person can’t eat', async () => {
    // Eleven weeks back: a week no other smoke file uses.
    const monday = new Date()
    monday.setDate(monday.getDate() - 77 - ((monday.getDay() + 6) % 7))
    const weekStart = monday.toISOString().slice(0, 10)
    // A shrimp recipe of the household's (the CI catalogue has no shellfish).
    const ing = await call(owner)('POST', '/ingredients/auto-create', { name: 'gambas peladas' })
    expect(ing.status).toBeLessThan(300)
    const rec = await call(owner)('POST', '/recipes', {
      name: 'Arroz tres delicias (smoke)',
      servings: 2,
      meals: ['lunch', 'dinner'],
      equipment: ['sartén'],
      seasons: ['spring', 'summer', 'autumn', 'winter'],
      ingredients: [{ ingredientId: ing.json.ingredient.id, quantity: 125, unit: 'g' }],
      steps: [{ index: 0, text: 'Saltea las gambas peladas a fuego vivo.' }],
      force: true,
    })
    expect(rec.status, JSON.stringify(rec.json)).toBe(201)
    const gen = await call(owner)('POST', '/menu/generate', { userId: owner.userId, weekStart })
    expect(gen.status).toBe(201)
    const ids = new Set<string>()
    for (const day of gen.json.days ?? []) {
      for (const slot of Object.values(day ?? {}) as Array<{ dishes?: Array<{ kind: string; recipeId?: string }> }>) {
        for (const d of slot?.dishes ?? []) if (d.kind === 'recipe' && d.recipeId) ids.add(d.recipeId)
      }
    }
    // What fits the guest («marisco»), as the picker's list computes it.
    const ok = new Set<string>()
    for (let page = 1; page <= 20; page++) {
      const fits = (await call(guest)('GET', `/recipes?perPage=100&page=${page}&fitsMe=1`)).json as Array<{ id: string }>
      for (const r of fits) ok.add(r.id)
      if (fits.length < 100) break
    }
    expect(ok.has(rec.json.id)).toBe(false)
    expect(ids.has(rec.json.id)).toBe(false)
    expect([...ids].filter((id) => !ok.has(id))).toEqual([])
  }, 90_000)
})
