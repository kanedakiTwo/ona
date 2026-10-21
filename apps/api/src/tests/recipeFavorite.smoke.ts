/**
 * Smoke (real API + Postgres): the recipe heart (feedback 2026-10-21: «el
 * botón me gusta en una receta no funciona o no cambia de color»). The
 * detail and the catalogue now say whether the reader hearted it, so the
 * button shows the saved state, also after a reload.
 */
import { describe, expect, it } from 'vitest'
import { API_URL, reachable } from './smokeEnv.js'

async function call(method: string, path: string, token?: string) {
  const r = await fetch(`${API_URL}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const text = await r.text()
  return { status: r.status, json: text ? JSON.parse(text) : null }
}

describe.skipIf(!reachable)('the recipe heart (favorite)', () => {
  it('the detail and the catalogue carry the reader\'s heart; toggling twice undoes it', async () => {
    const name = `fav_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const reg = await fetch(`${API_URL}/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, email: `${name}@test.local`, password: 'e2epass123', ageConfirmed: true }),
    })
    expect(reg.status).toBeLessThan(300)
    const { token, user } = await reg.json()

    const list = await call('GET', '/recipes?perPage=5', token)
    const recipe = list.json[0]
    expect(recipe.is_favorite).toBe(false)
    expect((await call('GET', `/recipes/${recipe.id}`, token)).json.is_favorite).toBe(false)

    expect((await call('POST', `/user/${user.id}/recipes/${recipe.id}/favorite`, token)).json).toEqual({ favorited: true })
    expect((await call('GET', `/recipes/${recipe.id}`, token)).json.is_favorite).toBe(true)
    const again = await call('GET', '/recipes?perPage=5', token)
    expect(again.json.find((r: any) => r.id === recipe.id).is_favorite).toBe(true)

    expect((await call('POST', `/user/${user.id}/recipes/${recipe.id}/favorite`, token)).json).toEqual({ favorited: false })
    expect((await call('GET', `/recipes/${recipe.id}`, token)).json.is_favorite).toBe(false)

    // Anonymous readers get no heart field at all.
    expect('is_favorite' in (await call('GET', `/recipes/${recipe.id}`)).json).toBe(false)
  }, 30_000)
})
