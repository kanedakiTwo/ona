/**
 * Smoke (real Postgres) for PRO-1078: the boot-time fix gives every recipe
 * — the catalogue's and a household's — the total with its waits, takes a
 * soak the night before out of a total, logs «antes → después», and a
 * second run changes nothing.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/recipeWaitTime.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { reachable, USER_ID } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { recipes, recipeSteps } from '../db/schema.js'
import { applyRecipeWaitTimes } from '../services/recipeWaitTime.js'

const tag = `pro1078${Date.now().toString(36)}`
const created: string[] = []

async function insert(
  name: string,
  authorId: string | null,
  times: { prepTime: number | null; cookTime: number | null; totalTime: number },
  steps: Array<{ text: string; durationMin?: number }>,
): Promise<string> {
  const [row] = await db
    .insert(recipes)
    .values({ name: `${name} ${tag}`, authorId, servings: 4, ...times, meals: ['dinner'] })
    .returning({ id: recipes.id })
  await db.insert(recipeSteps).values(steps.map((s, index) => ({ recipeId: row.id, index, ...s })))
  created.push(row.id)
  return row.id
}

const pizzaSteps = [
  { text: 'Mezcla la harina, la levadura, el agua y la sal y amasa' },
  { text: 'Tapa la masa y déjala reposar 1 hora' },
  { text: 'Estira la masa y pon el tomate, el jamón y la mozzarella' },
  { text: 'Hornea 15 minutos a 220 °C' },
]

const read = async (id: string) => (await db.select().from(recipes).where(eq(recipes.id, id)))[0]

afterAll(async () => {
  if (!reachable) return
  if (created.length) await db.delete(recipes).where(inArray(recipes.id, created))
})

describe.skipIf(!reachable)('recipe wait times (PRO-1078)', () => {
  it('system and household recipes, the soak out, log before → after, idempotent', async () => {
    const system = await insert('Pizza casera de prueba', null, { prepTime: 30, cookTime: 15, totalTime: 45 }, pizzaSteps)
    const mine = await insert('Pizza casera mía', USER_ID, { prepTime: 30, cookTime: 15, totalTime: 45 }, pizzaSteps)
    const soak = await insert('Balilah de prueba', USER_ID, { prepTime: null, cookTime: null, totalTime: 830 }, [
      { text: 'Pon los garbanzos a remojo la noche antes', durationMin: 720 },
      { text: 'Cuece los garbanzos', durationMin: 90 },
      { text: 'Aliña con comino y limón', durationMin: 20 },
    ])
    const ids = [system, mine, soak]
    const lines: string[] = []

    expect(await applyRecipeWaitTimes(db, (l) => lines.push(l), { ids })).toMatchObject({ changed: 3 })
    expect(await read(system)).toMatchObject({ prepTime: 30, cookTime: 15, totalTime: 90 })
    expect(await read(mine)).toMatchObject({ prepTime: 30, cookTime: 15, totalTime: 90 })
    expect((await read(soak)).totalTime).toBe(110)
    expect(lines.some((l) => l.includes(`Pizza casera de prueba ${tag}`) && l.includes('total 45 → 90'))).toBe(true)
    expect(lines.some((l) => l.includes(`Balilah de prueba ${tag}`) && l.includes('total 830 → 110'))).toBe(true)

    const again: string[] = []
    expect(await applyRecipeWaitTimes(db, (l) => again.push(l), { ids })).toMatchObject({ changed: 0 })
    expect(again).toEqual([])
  })
})
