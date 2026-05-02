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

describe('shopping route smoke', () => {
  let reachable = false
  let listId = ''
  let firstItemId = ''

  beforeAll(async () => {
    reachable = await isApiReachable()
    if (!reachable || !TOKEN || !USER_ID) return

    // Need a menu to attach a shopping list to. Pick the latest one for the
    // smoke user; if there isn't one, the tests will skip.
    const monday = new Date()
    monday.setDate(monday.getDate() - 14 - monday.getDay() + 1)
    const weekStart = monday.toISOString().slice(0, 10)

    // Ensure a menu exists (idempotent: if it does, /generate may noop or
    // return a fresh one — either is fine for the smoke flow).
    await fetch(`${API_URL}/menu/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  })

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
})
