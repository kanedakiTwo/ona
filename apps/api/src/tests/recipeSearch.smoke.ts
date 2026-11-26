/**
 * Smoke (real API + Postgres) for the recipe search (2026-11-25,
 * specs/recipes.md): `GET /recipes?search=` finds a name without its accents,
 * with empty words in between and with the words in another order, and lists
 * first the names that start with a searched word.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/recipeSearch.smoke.ts
 *
 * Skips when the API isn't reachable.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { recipes } from '../db/schema.js'

// One searchable word of letters and digits, unique to this run.
const tag = `busq${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const created: string[] = []

async function search(q: string): Promise<string[]> {
  const r = await fetch(`${API_URL}/recipes?perPage=100&search=${encodeURIComponent(q)}`)
  expect(r.status).toBe(200)
  return ((await r.json()) as Array<{ name: string }>).map((c) => c.name)
}

afterAll(async () => {
  if (reachable && created.length) await db.delete(recipes).where(inArray(recipes.id, created))
})

describe.skipIf(!reachable)('GET /recipes?search= (each word, no accents)', () => {
  const chuleton = `Chuletón ${tag} de ternera a la plancha con patatas`
  const ensalada = `Ensalada templada con chuletón ${tag}`

  it('finds it without accent, with «con» and in another order; a missing word finds nothing', async () => {
    // The salad is older, so the catalogue order alone would list it first.
    const rows = await db
      .insert(recipes)
      .values([
        { name: ensalada, servings: 2, authorId: null, createdAt: new Date('2020-01-01T00:00:00Z') },
        { name: chuleton, servings: 2, authorId: null, createdAt: new Date('2020-01-02T00:00:00Z') },
      ])
      .returning({ id: recipes.id })
    created.push(...rows.map((r) => r.id))

    expect(await search(`chuletón ${tag}`)).toEqual([chuleton, ensalada])
    expect(await search(`chuleton ${tag}`)).toEqual([chuleton, ensalada])
    expect(await search(`Chuletón con patatas ${tag}`)).toEqual([chuleton])
    expect(await search(`${tag} PATATAS chuleton`)).toEqual([chuleton])
    expect(await search(`chuleton ${tag} merluza`)).toEqual([])
  }, 30_000)
})
