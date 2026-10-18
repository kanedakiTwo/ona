/**
 * Smoke (PRO-225): `POST /menu/generate` with the «antes de planificar»
 * answers. «El jueves cenamos fuera y el martes somos 6» → no Thursday dinner,
 * 6 diners on Tuesday, and the saved plantilla doesn't change.
 * Requires SMOKE_USER_ID + SMOKE_USER_TOKEN (smoke orchestrator provides them).
 */
import { describe, it, expect } from 'vitest'
import { API_URL, TOKEN, USER_ID, authHeaders as auth, reachable } from './smokeEnv.js'

const ready = reachable && !!TOKEN && !!USER_ID

describe('week plan on POST /menu/generate (smoke)', () => {
  it.skipIf(!ready)('drops Thursday dinner and sets 6 on Tuesday for this week only', async () => {
    // Nine weeks back: a week no other smoke file uses.
    const monday = new Date()
    monday.setDate(monday.getDate() - 63 - ((monday.getDay() + 6) % 7))
    const weekStart = monday.toISOString().slice(0, 10)

    const settingsBefore = await (await fetch(`${API_URL}/user/${USER_ID}/settings`, { headers: auth() })).text()

    const res = await fetch(`${API_URL}/menu/generate`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        userId: USER_ID,
        weekStart,
        weekPlan: { mealsOut: [{ day: 3, meal: 'dinner' }], guests: [{ day: 1, diners: 6 }] },
      }),
    })
    expect(res.status).toBe(201)
    const menu = await res.json()
    expect(menu.days[3].dinner).toBeUndefined()
    expect(menu.days[3].lunch?.dishes?.length ?? 0).toBeGreaterThan(0)
    // The seeded catalogue only fills the first days of a week without
    // repeats, so the smoke puts the guests on Tuesday (the Saturday case is
    // the unit test, weekPlan.test.ts).
    expect(menu.days[1].lunch?.servings).toBe(6)
    expect(menu.days[1].dinner?.servings).toBe(6)
    expect(menu.days[0].lunch?.servings ?? null).toBeNull()
    expect(menu.days[2].dinner?.dishes?.length ?? 0).toBeGreaterThan(0)

    const settingsAfter = await (await fetch(`${API_URL}/user/${USER_ID}/settings`, { headers: auth() })).text()
    expect(settingsAfter).toBe(settingsBefore)

    // A bad plan is refused, not half-applied.
    const bad = await fetch(`${API_URL}/menu/generate`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ userId: USER_ID, weekStart, weekPlan: { guests: [{ day: 9, diners: 6 }] } }),
    })
    expect(bad.status).toBe(400)
  }, 60_000)
})
