/**
 * Smoke (E-93, hallazgos 3 y 4): another household's private recipe can't be
 * reached by its id.
 *   - PRO-1273: «Copiar receta» of a private recipe of another household is a
 *     404 (it copied everything, notes and tips included); copying a catalogue
 *     recipe, or one of your own household, still works.
 *   - PRO-1274: «Añadir plato» with that recipe is a 404 (its name, photo and
 *     ingredients used to show in the menu and the shopping list); a catalogue
 *     recipe still goes in.
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

describe('recetas privadas de otro hogar (smoke)', () => {
  it.skipIf(!reachable)(
    'B cannot copy nor add to its menu a private recipe of A; A’s household and the catalogue still work',
    async () => {
      const a = await register('priv_a')
      const b = await register('priv_b')
      const c = await register('priv_c')

      // A owns a private recipe (a copy of a catalogue one).
      const catalogue = await call('GET', '/recipes?perPage=2')
      const [cat1, cat2] = catalogue.json as Array<{ id: string }>
      const copyA = await call('POST', `/recipes/${cat1.id}/copy`, a.token)
      expect(copyA.status).toBeLessThan(300)
      const privateId: string = copyA.json.id ?? copyA.json.recipe?.id
      expect(privateId).toBeTruthy()

      // PRO-1273: B, from another household, gets a 404 — same as GET.
      expect((await call('GET', `/recipes/${privateId}`, b.token)).status).toBe(404)
      expect((await call('POST', `/recipes/${privateId}/copy`, b.token)).status).toBe(404)
      // …but copying a catalogue recipe still works for B.
      expect((await call('POST', `/recipes/${cat2.id}/copy`, b.token)).status).toBeLessThan(300)

      // C joins A's household: copying A's recipe works for C.
      const invite = await call('POST', '/households/me/invites', a.token, {})
      expect(invite.status).toBe(201)
      expect((await call('POST', `/invites/${invite.json.token}/accept`, c.token)).status).toBe(200)
      expect((await call('POST', `/recipes/${privateId}/copy`, c.token)).status).toBeLessThan(300)

      // PRO-1274: B's menu doesn't take A's private recipe.
      const monday = new Date()
      monday.setDate(monday.getDate() - 35 - monday.getDay() + 1)
      const gen = await call('POST', '/menu/generate', b.token, { userId: b.id, weekStart: monday.toISOString().slice(0, 10) })
      expect(gen.status, JSON.stringify(gen.json)).toBeLessThan(300)
      const menuId: string = gen.json.id ?? gen.json.menu?.id
      const add = (recipeId: string) =>
        call('POST', `/menu/${menuId}/day/0/meal/lunch/dish`, b.token, { kind: 'recipe', recipeId })
      expect((await add(privateId)).status).toBe(404)
      expect((await add(cat1.id)).status).toBe(200)
      const week = await call('GET', `/menu/${b.id}/${monday.toISOString().slice(0, 10)}`, b.token)
      expect(week.status).toBe(200)
      expect(JSON.stringify(week.json)).not.toContain(privateId)
    },
    120_000,
  )
})
