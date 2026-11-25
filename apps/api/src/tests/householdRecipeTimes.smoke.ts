/**
 * Smoke test against the smoke Postgres for PRO-1037: a household recipe
 * saved without minutes (Mimo's, before PRO-308) gets them estimated from
 * its steps on boot (`applyHouseholdRecipeTimes`), marked `times-estimated`;
 * a recipe with its time and a catalogue recipe are never touched; a second
 * run changes nothing.
 *
 *   API_URL=http://localhost:8790 DATABASE_URL=… SMOKE_USER_ID=… \
 *     pnpm --filter @ona/api exec vitest run src/tests/householdRecipeTimes.smoke.ts
 *
 * Skips when the smoke environment isn't up.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { USER_ID, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { recipeSteps, recipes } from '../db/schema.js'
import { applyHouseholdRecipeTimes, TIMES_ESTIMATED_TAG } from '../services/householdRecipeTimes.js'

const tag = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const created: string[] = []

describe('applyHouseholdRecipeTimes (smoke)', () => {
  afterAll(async () => {
    if (created.length > 0) await db.delete(recipes).where(inArray(recipes.id, created))
  })

  it.skipIf(!reachable || !USER_ID)('fills the minutes of a household recipe without time, and nothing else', async () => {
    const rows = await db
      .insert(recipes)
      .values([
        { name: `Merluza a la plancha con ensalada ${tag}`, servings: 2, authorId: USER_ID, internalTags: ['assistant-created'] },
        { name: `Tacos con su tiempo ${tag}`, servings: 2, authorId: USER_ID, prepTime: 10, cookTime: 5, totalTime: 15 },
        { name: `Sin pasos ${tag}`, servings: 2, authorId: USER_ID },
        { name: `Catálogo sin tiempo ${tag}`, servings: 2, authorId: null },
      ])
      .returning({ id: recipes.id, name: recipes.name })
    created.push(...rows.map((r) => r.id))
    const [merluza, tacos, noSteps, catalogue] = rows.map((r) => r.id)
    await db.insert(recipeSteps).values([
      { recipeId: merluza, index: 0, text: 'Sala los lomos de merluza.' },
      { recipeId: merluza, index: 1, text: 'Hazlos a la plancha 4 minutos por cada lado.' },
      { recipeId: merluza, index: 2, text: 'Aliña la ensalada.' },
      { recipeId: tacos, index: 0, text: 'Calienta las tortillas.' },
      { recipeId: catalogue, index: 0, text: 'Hornea 20 minutos.' },
    ] as any)

    const lines: string[] = []
    const res = await applyHouseholdRecipeTimes(db, (l) => lines.push(l))
    expect(res.filled).toBeGreaterThanOrEqual(1)
    expect(lines.some((l) => l.includes(merluza))).toBe(true)

    const after = new Map(
      (await db.select().from(recipes).where(inArray(recipes.id, created))).map((r) => [r.id, r]),
    )
    expect(after.get(merluza)).toMatchObject({ prepTime: 14, cookTime: 0, activeTime: 14, totalTime: 14 })
    expect(after.get(merluza)!.internalTags).toEqual(['assistant-created', TIMES_ESTIMATED_TAG])
    expect(after.get(tacos)).toMatchObject({ prepTime: 10, cookTime: 5, totalTime: 15, activeTime: null })
    expect(after.get(tacos)!.internalTags ?? []).not.toContain(TIMES_ESTIMATED_TAG)
    expect(after.get(noSteps)).toMatchObject({ totalTime: null })
    expect(res.missing).toContain(`Sin pasos ${tag}`)
    expect(after.get(catalogue)).toMatchObject({ totalTime: null })

    // Idempotent: the second run leaves our recipes as they are (one tag, same minutes).
    await applyHouseholdRecipeTimes(db, () => {})
    const again = (await db.select().from(recipes).where(inArray(recipes.id, [merluza])))[0]
    expect(again).toMatchObject({ totalTime: 14, activeTime: 14 })
    expect(again.internalTags).toEqual(['assistant-created', TIMES_ESTIMATED_TAG])
  })
})
