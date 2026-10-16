/**
 * Smoke (real API + Postgres) for PRO-140 (specs/recipes.md): the catalogue
 * puts the recipe more households have in favourites first, and a retired
 * catalogue recipe (`retirada` in internal_tags) leaves the listing but still
 * opens by id.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/recipeCatalogOrder.smoke.ts
 *
 * Needs REGISTRATION_MODE=open (CI's smoke job sets it); skips when the API
 * isn't reachable.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { recipes, userFavorites } from '../db/schema.js'

const tag = `cat_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const userIds: string[] = []
let retiredId: string | null = null
let retiredTags: string[] | null = null

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function register(i: number) {
  const u = `${tag}${i}`
  const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  userIds.push(reg.body.user.id)
  return { id: reg.body.user.id as string, token: reg.body.token as string }
}

afterAll(async () => {
  if (!reachable) return
  if (userIds.length) await db.delete(userFavorites).where(inArray(userFavorites.userId, userIds))
  if (retiredId) await db.update(recipes).set({ internalTags: retiredTags ?? [] }).where(eq(recipes.id, retiredId))
})

describe.skipIf(!reachable)('catalogue order and retired recipes (PRO-140)', () => {
  it('more households with it in favourites put a recipe first', async () => {
    const before = await call('GET', '/recipes?perPage=100')
    expect(before.status).toBe(200)
    const target = before.body.at(-1)
    // One more household than the current leader (2 on a fresh database).
    const top = await db.execute(sql`SELECT coalesce(max(n), 0)::int AS n FROM (SELECT count(DISTINCT coalesce(household_id, user_id)) AS n FROM user_favorites GROUP BY recipe_id) t`)
    const needed = Math.max(2, Number((top.rows as any[])[0].n) + 1)
    for (let i = 1; i <= needed; i++) {
      const u = await register(i)
      const fav = await call('POST', `/user/${u.id}/recipes/${target.id}/favorite`, {}, u.token)
      expect(fav.status).toBeLessThan(300)
    }
    const after = await call('GET', '/recipes?perPage=100')
    expect(after.body[0].id).toBe(target.id)
    expect(JSON.stringify(after.body[0])).not.toMatch(/favoriteHouseholds/)
  }, 30_000)

  it('a retired catalogue recipe leaves the listing and still opens by id', async () => {
    const list = await call('GET', '/recipes?perPage=100')
    const victim = list.body.at(-2)
    const [row] = await db.select({ internalTags: recipes.internalTags }).from(recipes).where(and(eq(recipes.id, victim.id)))
    retiredId = victim.id
    retiredTags = row.internalTags ?? []
    await db.update(recipes).set({ internalTags: [...retiredTags, 'retirada'] }).where(eq(recipes.id, victim.id))

    const after = await call('GET', '/recipes?perPage=100')
    expect(after.body.map((r: any) => r.id)).not.toContain(victim.id)
    expect(Number(after.body.length)).toBe(list.body.length - 1)
    const detail = await call('GET', `/recipes/${victim.id}`)
    expect(detail.status).toBe(200)
  }, 30_000)
})
