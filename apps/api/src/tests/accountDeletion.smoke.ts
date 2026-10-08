/**
 * Smoke: "Borrar mi cuenta" against the real API + DB.
 *   - wrong password → 401, nothing deleted;
 *   - the owner of a shared household deletes their account:
 *     their private recipe is gone (it must NOT turn into a catalogue recipe),
 *     the other member inherits the household and keeps the shared week;
 *   - the deleted session stops working (401 USER_NOT_FOUND).
 * Registers its own users; only needs a reachable API.
 */
import { describe, it, expect } from 'vitest'
import { API_URL, reachable } from './smokeEnv.js'

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: r.status, json }
}

async function register(tag: string) {
  const name = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const r = await call('POST', '/register', undefined, { username: name, email: `${name}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(r.status).toBeLessThan(300)
  return { token: r.json.token as string, id: r.json.user.id as string }
}

describe('account deletion (smoke)', () => {
  it.skipIf(!reachable)(
    'owner deletes their account: private recipe gone, household + week handed over',
    async () => {
      const a = await register('del_a')
      const b = await register('del_b')

      // B joins A's household.
      const invite = await call('POST', '/households/me/invites', a.token, {})
      expect(invite.status).toBe(201)
      expect((await call('POST', `/invites/${invite.json.token}/accept`, b.token)).status).toBe(200)
      const before = await call('GET', '/households/me', b.token)
      const householdId = before.json.id

      // A owns a private recipe (copy of a catalogue one) and plans the shared week.
      const catalogue = await call('GET', '/recipes?perPage=1')
      const copy = await call('POST', `/recipes/${catalogue.json[0].id}/copy`, a.token)
      expect(copy.status).toBeLessThan(300)
      const privateId = copy.json.id ?? copy.json.recipe?.id
      const monday = new Date()
      monday.setDate(monday.getDate() - 28 - monday.getDay() + 1)
      const weekStart = monday.toISOString().slice(0, 10)
      expect((await call('POST', '/menu/generate', a.token, { userId: a.id, weekStart })).status).toBe(201)

      // Wrong password: refused, nothing deleted.
      expect((await call('DELETE', `/user/${a.id}`, a.token, { password: 'nope' })).status).toBe(401)
      expect((await call('DELETE', `/user/${b.id}`, a.token, { password: 'e2epass123', ageConfirmed: true })).status).toBe(403)

      const del = await call('DELETE', `/user/${a.id}`, a.token, { password: 'e2epass123', ageConfirmed: true })
      expect(del.status).toBe(200)
      expect(del.json).toMatchObject({ deleted: true, recipesDeleted: 1, householdsTransferred: 1 })

      // The private recipe didn't become a catalogue recipe.
      expect((await call('GET', `/recipes/${privateId}`)).status).toBe(404)
      expect((await call('GET', `/recipes/${privateId}`, b.token)).status).toBe(404)

      // B owns the household now and still sees the week A planned.
      const after = await call('GET', '/households/me', b.token)
      expect(after.json.id).toBe(householdId)
      expect(after.json.ownerId).toBe(b.id)
      const week = await call('GET', `/menu/${b.id}/${weekStart}`, b.token)
      expect(week.status).toBe(200)

      // A's old session is dead.
      const gone = await call('GET', `/user/${a.id}`, a.token)
      expect(gone.status).toBe(401)
      expect(gone.json.code).toBe('USER_NOT_FOUND')
    },
    120_000,
  )
})
