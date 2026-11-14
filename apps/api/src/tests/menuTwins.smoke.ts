/**
 * Smoke (real API + Postgres) for PRO-390: the twins' query reads real
 * households with a menu (never `@example.com`), and the endpoint gives only
 * closed-list fields, no text, and no combination of fewer than 3 households.
 *
 *   API_URL=… DATABASE_URL=… METRICS_READ_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/menuTwins.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { COOKING_STYLES, WEEKDAY_COOKING_CHOICES } from '@ona/shared'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { madridWeekStart } from '../services/madridTime.js'
import { TWIN_ALLERGIES, TWIN_BUDGETS, TWIN_CUISINES, TWIN_DIETS, TWIN_MIN_GROUP, loadTwinSources, profileKey } from '../services/menuTwins.js'

async function call(method: string, path: string, payload?: unknown, token?: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

const NOTE = 'Gemelosecreto: mi vecina Remedios'

async function household(domain: string, restrictions: string[]) {
  const u = `gemelo_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call('POST', '/register', { username: u, email: `${u}@${domain}`, password: 'smokepass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const userId = reg.body.user.id as string
  const token = reg.body.token as string
  const onboarding = await call('POST', `/user/${userId}/onboarding`, {
    adults: 3, kidsCount: 2, cookingStyle: 'batch', restrictions, healthConsent: true, weekdayCooking: 'rapido', cookingNote: NOTE,
  }, token)
  expect(onboarding.status).toBe(200)
  expect((await call('POST', '/menu/generate', { userId, weekStart: madridWeekStart(new Date()) }, token)).status).toBe(201)
  return u
}

describe.skipIf(!reachable)('gemelos de los hogares reales (PRO-390)', () => {
  it('reads real households with a menu, and gives only closed lists in combinations of 3 or more', { timeout: 60_000 }, async () => {
    const names = [
      await household('test.local', ['soja']),
      await household('test.local', ['soja', 'huevo']),
      await household('test.local', ['sin gluten']),
      await household('example.com', ['soja']),
    ]

    const sources = await loadTwinSources(db)
    const ours = sources.filter((s) => s.adults === 3 && s.kidsCount === 2 && s.cookingStyle === 'batch')
    expect(ours.length).toBeGreaterThanOrEqual(3)
    expect(ours.some((s) => s.restrictions.includes('soja') && s.restrictions.includes('huevo'))).toBe(true)
    expect(ours.some((s) => s.restrictions.includes('sin gluten'))).toBe(true)

    const metricsToken = process.env.METRICS_READ_TOKEN ?? 'smoke-metrics-token'
    const res = await call('GET', '/admin/menu-planner/gemelos', undefined, undefined, { 'x-metrics-token': metricsToken })
    expect(res.status).toBe(200)
    expect(res.body.households).toBe(sources.length)
    expect(res.body.twins).toHaveLength(sources.length)
    const counts = new Map<string, number>()
    for (const t of res.body.twins) {
      expect(Object.keys(t).sort()).toEqual(['adults', 'allergies', 'budget', 'cookingStyle', 'cuisines', 'diet', 'kidsCount', 'swapsOut', 'weekdayCooking'])
      expect(TWIN_DIETS).toContain(t.diet)
      expect(TWIN_BUDGETS).toContain(t.budget)
      if (t.cookingStyle !== null) expect(COOKING_STYLES).toContain(t.cookingStyle)
      if (t.weekdayCooking !== null) expect(WEEKDAY_COOKING_CHOICES).toContain(t.weekdayCooking)
      for (const c of t.cuisines) expect(TWIN_CUISINES).toContain(c)
      for (const a of t.allergies) expect(TWIN_ALLERGIES).toContain(a)
      for (const s of t.swapsOut) expect(s).toMatch(/^tipo:[a-z0-9-]+$/)
      counts.set(profileKey(t), (counts.get(profileKey(t)) ?? 0) + 1)
    }
    expect([...counts.values()].every((n) => n >= TWIN_MIN_GROUP)).toBe(true)
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(/Gemelosecreto|Remedios|@|gemelo_/)
    for (const n of names) expect(text).not.toContain(n)
  })
})
