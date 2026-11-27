/**
 * Smoke (real API + Postgres) for PRO-1119 (D-164.1): `recipes` en
 * /admin/metrics cuenta, por lote, las recetas en borrador y no las publicadas.
 *
 *   API_URL=… DATABASE_URL=… METRICS_READ_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/draftRecipes.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { recipes } from '../db/schema.js'
import { loadDraftRecipes } from '../services/draftRecipes.js'

const tag = `pro1119-${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const batchA = `${tag}-a`
const batchB = `${tag}-b`
const ids: string[] = []

async function recipe(name: string, status: 'draft' | 'published', importBatch: string | null) {
  const [r] = await db.insert(recipes).values({ name: `${name} ${tag}`, servings: 2, status, importBatch } as any).returning({ id: recipes.id })
  ids.push(r.id)
}

afterAll(async () => {
  if (ids.length) await db.delete(recipes).where(inArray(recipes.id, ids))
})

describe.skipIf(!reachable)('recipes en borrador (PRO-1119)', () => {
  it('cuenta los borradores por lote y deja fuera las publicadas', async () => {
    const before = await loadDraftRecipes()

    await recipe('Lentejas con chorizo', 'draft', batchA)
    await recipe('Merluza en salsa verde', 'draft', batchA)
    await recipe('Crema de calabaza', 'draft', batchB)
    await recipe('Tortilla de patatas', 'published', batchA)
    await recipe('Gazpacho', 'published', null)

    const after = await loadDraftRecipes()
    expect(after.draft - before.draft).toBe(3)
    expect(after.draftByBatch[batchA]).toBe(2)
    expect(after.draftByBatch[batchB]).toBe(1)

    const token = process.env.METRICS_READ_TOKEN
    if (token) {
      const res = await fetch(`${API_URL}/admin/metrics?weeks=1`, { headers: { 'x-metrics-token': token } })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.recipes.draftByBatch[batchA]).toBe(2)
      expect(body.recipes.draftByBatch[batchB]).toBe(1)
      expect(body.recipes.draft).toBe(after.draft)
    }
  })
})
