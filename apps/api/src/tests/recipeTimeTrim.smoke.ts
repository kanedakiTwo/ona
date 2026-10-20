/**
 * Smoke (real Postgres) for PRO-284: the boot-time fix of the catalogue
 * times changes only system recipes, never the cook time, logs every recipe
 * «antes → después», and a second run changes nothing.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/recipeTimeTrim.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { reachable, USER_ID } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { recipes, recipeSteps } from '../db/schema.js'
import { applyCatalogTimeTrim, TIME_TRIM_TAG } from '../services/recipeTimeTrim.js'

const tag = `pro284${Date.now().toString(36)}`
const created: string[] = []

async function insert(name: string, authorId: string | null): Promise<string> {
  const [row] = await db
    .insert(recipes)
    .values({ name: `${name} ${tag}`, authorId, servings: 4, prepTime: 20, cookTime: 40, activeTime: 20, totalTime: 60, meals: ['dinner'], internalTags: authorId ? [] : ['compartida'] })
    .returning({ id: recipes.id })
  await db.insert(recipeSteps).values([
    { recipeId: row.id, index: 0, text: 'Picar la cebolla y preparar la salsa' },
    { recipeId: row.id, index: 1, text: 'Hornear 40 minutos a 200 °C', durationMin: 40 },
  ])
  created.push(row.id)
  return row.id
}

const read = async (id: string) => (await db.select().from(recipes).where(eq(recipes.id, id)))[0]

afterAll(async () => {
  if (!reachable) return
  if (created.length) await db.delete(recipes).where(inArray(recipes.id, created))
})

describe.skipIf(!reachable)('catalogue time trim (PRO-284)', () => {
  it('only system recipes, cook time intact, log before → after, idempotent', async () => {
    const system = await insert('Pollo al horno de prueba', null)
    const mine = await insert('Pollo al horno mío', USER_ID)
    const lines: string[] = []

    const res = await applyCatalogTimeTrim(db, (l) => lines.push(l), { ids: [system, mine] })
    expect(res).toMatchObject({ systemRecipes: 1, changed: 1 })

    const s = await read(system)
    expect(s.cookTime).toBe(40)
    expect(s.prepTime).toBe(16)
    expect(s.totalTime).toBeGreaterThanOrEqual(40)
    expect(s.totalTime).toBeLessThan(60)
    expect(s.activeTime!).toBeLessThanOrEqual(s.totalTime!)
    expect(s.internalTags).toEqual(['compartida', TIME_TRIM_TAG])
    expect(lines.some((l) => l.includes(`Pollo al horno de prueba ${tag}`) && l.includes('total 60 → 48') && l.includes('preparación 20 → 16'))).toBe(true)

    const u = await read(mine)
    expect(u).toMatchObject({ prepTime: 20, cookTime: 40, activeTime: 20, totalTime: 60, internalTags: [] })

    const again: string[] = []
    expect(await applyCatalogTimeTrim(db, (l) => again.push(l), { ids: [system, mine] })).toMatchObject({ changed: 0 })
    expect(await read(system)).toMatchObject({ prepTime: 16, cookTime: 40, totalTime: 48 })
    expect(again).toEqual([])
  })
})
