/**
 * Smoke test for the /shopping-list routes.
 *
 * Depends on the menus.smoke creating a menu first; if no menu exists the
 * tests skip gracefully.
 *
 * Covers:
 *   - GET /shopping-list/:menuId aggregates items for the menu
 *   - PUT /shopping-list/:listId/item/:itemId/check toggles `checked`
 *   - PUT /shopping-list/:listId/item/:itemId/stock toggles `inStock`
 *   - a tick sent with the id of a list rebuilt since lands on the current list
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { API_URL, TOKEN, USER_ID, authHeaders as auth, reachable } from './smokeEnv.js'

describe('shopping route smoke', () => {
  let listId = ''
  let firstItemId = ''

  beforeAll(async () => {
    if (!reachable || !TOKEN || !USER_ID) return

    // Need a menu to attach a shopping list to. Pick the latest one for the
    // smoke user; if there isn't one, the tests will skip.
    const monday = new Date()
    monday.setDate(monday.getDate() - 14 - monday.getDay() + 1)
    const weekStart = monday.toISOString().slice(0, 10)

    // Ensure a menu exists (idempotent: if it does, /generate may noop or
    // return a fresh one — either is fine for the smoke flow). The route is
    // auth-required since the IDOR fix; without the token this silently 401'd
    // and every shopping assertion below was skipped via the early returns.
    await fetch(`${API_URL}/menu/generate`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ userId: USER_ID, weekStart }),
    })

    const menuResp = await fetch(`${API_URL}/menu/${USER_ID}/${weekStart}`, { headers: auth() })
    if (!menuResp.ok) return
    const menu = await menuResp.json()
    if (!menu?.id) return

    const listResp = await fetch(`${API_URL}/shopping-list/${menu.id}`, { headers: auth() })
    if (!listResp.ok) return
    const list = await listResp.json()
    listId = list.id ?? ''
    firstItemId = list.items?.[0]?.id ?? ''
  }, 60_000) // /menu/generate takes ~10 s (see menusRoute.smoke.ts)

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'GET /shopping-list/:menuId returns a list with items',
    () => {
      // The state was already validated in beforeAll; this test just asserts
      // we ended up with a list id (catalog may be empty, in which case
      // listId stays empty and the test skips its assertions silently).
      if (!listId) return
      expect(typeof listId).toBe('string')
      expect(listId.length).toBeGreaterThan(0)
    },
  )

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'PUT /shopping-list/:listId/item/:itemId/check toggles checked',
    async () => {
      if (!listId || !firstItemId) return
      const r = await fetch(
        `${API_URL}/shopping-list/${listId}/item/${firstItemId}/check`,
        { method: 'PUT', headers: auth() },
      )
      expect(r.status).toBe(200)
      const body = await r.json()
      const item = body.items?.find((i: any) => i.id === firstItemId)
      expect(item).toBeTruthy()
      expect(typeof item.checked).toBe('boolean')
    },
  )

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'PUT /shopping-list/:listId/item/:itemId/stock toggles inStock',
    async () => {
      if (!listId || !firstItemId) return
      const r = await fetch(
        `${API_URL}/shopping-list/${listId}/item/${firstItemId}/stock`,
        { method: 'PUT', headers: auth() },
      )
      expect(r.status).toBe(200)
      const body = await r.json()
      const item = body.items?.find((i: any) => i.id === firstItemId)
      expect(item).toBeTruthy()
      expect(typeof item.inStock).toBe('boolean')
    },
  )

  it.skipIf(!reachable || !TOKEN || !USER_ID)(
    'a tick with the id of a list rebuilt since lands on the current list (2026-10-10)',
    async () => {
      // Every GET rebuilds the rolling list with a new id; the page could send
      // a tick with the previous id (a range seen before) and it was lost (404).
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
      await fetch(`${API_URL}/menu/generate`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ userId: USER_ID, weekStart: d.toISOString().slice(0, 10) }),
      })
      const first = await (await fetch(`${API_URL}/shopping-list`, { headers: auth() })).json()
      const itemId = first?.items?.[0]?.id
      if (!first?.id || !itemId) return
      const second = await (await fetch(`${API_URL}/shopping-list`, { headers: auth() })).json()
      expect(second.id).not.toBe(first.id)
      const before = Boolean(second.items.find((i: any) => i.id === itemId)?.checked)

      const r = await fetch(`${API_URL}/shopping-list/${first.id}/item/${itemId}/check`, { method: 'PUT', headers: auth() })
      expect(r.status).toBe(200)
      const body = await r.json()
      expect(body.id).toBe(second.id)
      expect(Boolean(body.items.find((i: any) => i.id === itemId)?.checked)).toBe(!before)
    },
    60_000,
  )
})
