/**
 * PRO-21 (RGPD art. 9) against a running API + Postgres: health data is
 * stored only with the explicit consent (date + version recorded), and
 * withdrawing it deletes every copy (users columns, memory, profile blob).
 * Registers its own throwaway users. Skips when the API isn't reachable.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { reachable } from './smokeEnv.js'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'

interface Session { token: string; userId: string }

async function register(): Promise<Session> {
  const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `salud_${id}`, email: `salud_${id}@test.local`, password: 'smokepass123', ageConfirmed: true }),
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

const onboarding = (healthConsent: boolean) => ({
  adults: 2,
  kidsCount: 0,
  cookingFreq: 'daily',
  restrictions: ['sin gluten'],
  favoriteDishes: ['lentejas'],
  priority: 'healthy',
  healthConsent,
})

describe.skipIf(!reachable)('health-data consent (smoke)', () => {
  let a: Session
  let b: Session
  beforeAll(async () => {
    a = await register()
    b = await register()
  })

  it('onboarding without the box: restrictions are not stored, no consent on record', async () => {
    const api = call(a)
    expect((await api('POST', `/user/${a.userId}/onboarding`, onboarding(false))).status).toBe(200)
    const user = (await api('GET', `/user/${a.userId}`)).json
    expect(user.restrictions).toEqual([])
    expect(user.healthConsentAt).toBeNull()
    // Nor through the profile or the memory.
    expect((await api('PUT', `/user/${a.userId}`, { age: 40 })).status).toBe(403)
    expect((await api('PATCH', '/memory', { key: 'restrictions', value: ['sin lactosa'] })).status).toBe(403)
    const consent = (await api('GET', `/user/${a.userId}/health-consent`)).json
    expect(consent).toMatchObject({ active: false, hasHealthData: false, needsPrompt: false })
  })

  it('onboarding with the box: stored, with date and version', async () => {
    const api = call(b)
    expect((await api('POST', `/user/${b.userId}/onboarding`, onboarding(true))).status).toBe(200)
    const user = (await api('GET', `/user/${b.userId}`)).json
    expect(user.restrictions).toEqual(['sin gluten'])
    expect(user.healthConsentVersion).toBe('salud-v1-2026-10')
    expect(Date.parse(user.healthConsentAt)).toBeGreaterThan(Date.now() - 120_000)
  })

  it('withdrawing the consent deletes the health data everywhere', async () => {
    const api = call(b)
    expect((await api('PUT', `/user/${b.userId}`, { age: 40, weight: 70 })).status).toBe(200)
    expect((await api('PATCH', '/memory', { key: 'physical.weight_kg', value: 70 })).status).toBe(200)
    expect((await api('PUT', `/user/${b.userId}/settings`, {
      template: { physical: { age: 40 }, preferences: { restrictions: ['sin gluten'] } },
    })).status).toBe(200)

    const after = (await api('POST', `/user/${b.userId}/health-consent`, { consent: false })).json
    expect(after).toMatchObject({ active: false, hasHealthData: false, needsPrompt: false })
    expect(after.withdrawnAt).toBeTruthy()

    const user = (await api('GET', `/user/${b.userId}`)).json
    expect(user).toMatchObject({ restrictions: [], age: null, weight: null })
    const memory = (await api('GET', '/memory')).json
    expect(memory['physical.weight_kg']).toBeUndefined()
    const settings = (await api('GET', `/user/${b.userId}/settings`)).json
    expect(settings.template.physical).toBeUndefined()
    expect(settings.template.preferences.restrictions).toEqual([])
  })
})
