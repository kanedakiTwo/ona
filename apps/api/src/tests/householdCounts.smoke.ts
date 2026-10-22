/**
 * Smoke for the household counts against a running API + Postgres
 * (2026-10-22: a tester told Mimo about her kids and her profile still said
 * 0 niños). What Mimo notes in memory is the account's count too, and a
 * change in the profile refreshes Mimo's copy.
 *
 *   API_URL=http://localhost:8716 pnpm --filter @ona/api exec vitest run src/tests/householdCounts.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { API_URL, reachable } from './smokeEnv.js'

async function call(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function freshUser() {
  const tag = `hogar_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call('POST', '/register', { username: tag, email: `${tag}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const auth = { Authorization: `Bearer ${reg.body.token}` }
  const userId = reg.body.user.id as string
  const onboarding = await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'varied' }, auth)
  expect(onboarding.status).toBe(200)
  return { auth, userId }
}

describe.skipIf(!reachable)('household counts smoke', () => {
  it('kids noted in memory show in the account; the profile then refreshes the memory', async () => {
    const { auth, userId } = await freshUser()
    const noted = await call('PATCH', '/memory', { facts: [{ key: 'household.adults', value: 2 }, { key: 'household.kids_2_to_10', value: 2 }] }, auth)
    expect(noted.status).toBe(200)
    expect((await call('GET', `/user/${userId}`, undefined, auth)).body).toMatchObject({ adults: 2, kidsCount: 2 })

    expect((await call('PUT', `/user/${userId}`, { kidsCount: 3 }, auth)).status).toBe(200)
    const memory = (await call('GET', '/memory', undefined, auth)).body
    expect(memory['household.kids_2_to_10'].value).toBe(3)
    expect(memory['household.adults'].value).toBe(2)
  })
})
