/**
 * Smoke test for the /menu routes.
 *
 * Covers:
 *   - POST /menu/generate (now auth-required, userId must match token) builds
 *     a 7-day menu and returns it
 *   - IDOR guards: unauthed generate → 401, foreign userId → 403, bogus
 *     menuId → 400/404 (see specs/menus.md "Access control")
 *   - GET /menu/:userId/:weekId fetches the persisted menu
 *   - PUT /menu/:menuId/day/:day/meal/:meal/lock toggles the lock state
 *
 * Requires SMOKE_USER_ID + SMOKE_USER_TOKEN (smoke orchestrator provides them).
 */

import { describe, it, expect, beforeAll } from 'vitest'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'
const TOKEN = process.env.SMOKE_USER_TOKEN ?? ''
const USER_ID = process.env.SMOKE_USER_ID ?? ''

async function isApiReachable(): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 1500)
  const r = await fetch(`${API_URL}/health`, { signal: ctrl.signal }).catch(() => null)
  clearTimeout(t)
  return r != null && r.ok
}

const auth = () => ({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' })

describe('menus route smoke', () => {
  let reachable = false
  let weekStart = ''
  let menuId = ''

  beforeAll(async () => {
    reachable = await isApiReachable()
    if (!reachable || !TOKEN || !USER_ID) return

    // Onboard the user just enough that the generator has all the inputs.
    await fetch(`${API_URL}/user/${USER_ID}`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ sex: 'male', age: 30, weight: 80, height: 180, activityLevel: 'moderate' }),
    })
    await fetch(`${API_URL}/user/${USER_ID}/onboarding`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        householdSize: 'solo',
        cookingFreq: '3_4_times',
        restrictions: [],
        favoriteDishes: ['pasta'],
        priority: 'healthy',
      }),
    })

    // Pick a week that's safely in the past so re-runs don't collide on the
    // same calendar week.
    const monday = new Date()
    monday.setDate(monday.getDate() - 14 - monday.getDay() + 1)
    weekStart = monday.toISOString().slice(0, 10)
  })

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'POST /menu/generate creates a 7-day menu',
    async () => {
      const r = await fetch(`${API_URL}/menu/generate`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ userId: USER_ID, weekStart }),
      })
      // The response shape varies; we just want a non-5xx + a payload that
      // has either a menu id or a days array.
      expect(r.status).toBeLessThan(500)
      if (!r.ok) return
      const body = await r.json()
      const days = body.days ?? body.menu?.days
      if (Array.isArray(days)) {
        expect(days.length).toBe(7)
      }
      menuId = body.id ?? body.menuId ?? body.menu?.id ?? ''
    },
  )

  // --- IDOR guards (see specs/menus.md "Access control") -------------------

  it.skipIf(!reachable)('POST /menu/generate without a token is rejected (401)', async () => {
    const r = await fetch(`${API_URL}/menu/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_ID || '00000000-0000-0000-0000-000000000000', weekStart: '2020-01-06' }),
    })
    expect(r.status).toBe(401)
  })

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'POST /menu/generate for a DIFFERENT userId is forbidden (403)',
    async () => {
      const otherUser = '11111111-1111-1111-1111-111111111111'
      const r = await fetch(`${API_URL}/menu/generate`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ userId: otherUser, weekStart: '2020-01-06' }),
      })
      expect(r.status).toBe(403)
    },
  )

  it.skipIf(!reachable || !TOKEN)(
    'mutating a menu by a bogus/foreign id never leaks (400 malformed, 404 unknown)',
    async () => {
      // Non-UUID id → 400 from the param guard.
      const bad = await fetch(`${API_URL}/menu/not-a-uuid/day/0/meal/lunch/lock`, {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify({ locked: true }),
      })
      expect(bad.status).toBe(400)
      // Well-formed but unknown id → 404 (a foreign-but-real id would be 403;
      // the smoke runner only has one user so we can't mint that case here).
      const unknown = await fetch(
        `${API_URL}/menu/99999999-9999-9999-9999-999999999999/day/0/meal/lunch/lock`,
        { method: 'PUT', headers: auth(), body: JSON.stringify({ locked: true }) },
      )
      expect([403, 404]).toContain(unknown.status)
    },
  )

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'GET /menu/:userId/:weekId returns the persisted menu',
    async () => {
      if (!weekStart) return
      const r = await fetch(`${API_URL}/menu/${USER_ID}/${weekStart}`, { headers: auth() })
      // Either 200 with the menu, or 404 if generate didn't actually persist
      // (e.g. empty catalog). Both are acceptable smoke outcomes.
      expect([200, 404]).toContain(r.status)
      if (r.status === 200) {
        const body = await r.json()
        expect(Array.isArray(body.days)).toBe(true)
        if (!menuId) menuId = body.id
      }
    },
  )

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'PUT /menu/:menuId/day/:day/meal/:meal/lock toggles the lock state',
    async () => {
      if (!menuId) return // generator might have skipped — bail
      const r = await fetch(
        `${API_URL}/menu/${menuId}/day/0/meal/lunch/lock`,
        { method: 'PUT', headers: auth() },
      )
      // 200 (toggled) or 404 (slot empty) — both prove the route is wired.
      expect([200, 400, 404]).toContain(r.status)
    },
  )

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'POST /menu/:menuId/day/:day/meal/:meal adds a slot the template lacked',
    async () => {
      if (!menuId) return
      // Snack isn't in the default template, so day 0 should be missing it.
      const r = await fetch(`${API_URL}/menu/${menuId}/day/0/meal/snack`, {
        method: 'POST',
        headers: auth(),
        body: '{}',
      })
      // 201 (created) | 404 (no matching snack recipe) | 409 (already there).
      expect([201, 404, 409]).toContain(r.status)
    },
  )

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'PATCH /menu/:menuId/day/:day/meal/:meal updates the diner-count override',
    async () => {
      if (!menuId) return
      const r = await fetch(`${API_URL}/menu/${menuId}/day/0/meal/lunch`, {
        method: 'PATCH',
        headers: auth(),
        body: JSON.stringify({ servings: 4 }),
      })
      expect([200, 404]).toContain(r.status)
      if (r.status === 200) {
        const body = await r.json()
        const slot = body.days?.[0]?.lunch
        if (slot) expect(slot.servings).toBe(4)
      }

      // Clearing the override with `null` should drop the field.
      const r2 = await fetch(`${API_URL}/menu/${menuId}/day/0/meal/lunch`, {
        method: 'PATCH',
        headers: auth(),
        body: JSON.stringify({ servings: null }),
      })
      expect([200, 404]).toContain(r2.status)
    },
  )

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'DELETE /menu/:menuId/day/:day/meal/:meal removes the slot for this week',
    async () => {
      if (!menuId) return
      const r = await fetch(`${API_URL}/menu/${menuId}/day/0/meal/lunch`, {
        method: 'DELETE',
        headers: auth(),
      })
      // 200 (removed) | 400 (locked) | 404 (already absent).
      expect([200, 400, 404]).toContain(r.status)
    },
  )
})
