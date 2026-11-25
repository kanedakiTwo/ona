/**
 * Smoke (Postgres) for PRO-402 (2): the batch of corrected times. The review
 * run writes nothing; `apply` writes the times and the preparativo; a second
 * run changes nothing. On an invented copy of a catalogue recipe.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/recipeTimeFixes402.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { recipeSteps, recipes } from '../db/schema.js'
import { applyTimeFixes402, type TimeFix } from '../services/recipeTimeFixes402.js'

const tag = `pro402${Date.now().toString(36)}`
const created: string[] = []

afterAll(async () => {
  if (!reachable || !created.length) return
  await db.delete(recipes).where(inArray(recipes.id, created))
})

describe.skipIf(!reachable)('PRO-402: the batch of corrected times against Postgres', () => {
  it('review writes nothing; apply writes once; a second run changes nothing', async () => {
    const [src] = await db.select().from(recipes).where(and(isNull(recipes.authorId), eq(recipes.status, 'published'))).orderBy(asc(recipes.name)).limit(1)
    const { id: _id, createdAt: _c, updatedAt: _u, featuredOn: _f, ...rest } = src
    const [row] = await db
      .insert(recipes)
      .values({ ...rest, name: `Migas de prueba ${tag}`, prepTime: 36, cookTime: 605, totalTime: 641, activeTime: 40, advancePrep: [], internalTags: ['tiempos-pro284'], importBatch: tag, imageUrl: null })
      .returning({ id: recipes.id })
    created.push(row.id)
    await db.insert(recipeSteps).values([
      { recipeId: row.id, index: 0, text: 'Humedecemos el pan y lo dejamos reposar tapado toda la noche.', durationMin: 600 },
      { recipeId: row.id, index: 1, text: 'Freímos los ajos y el chorizo.', durationMin: 10 },
      { recipeId: row.id, index: 2, text: 'Añadimos el pan y lo removemos hasta que esté dorado.', durationMin: 30 },
    ])
    const fix: TimeFix = {
      id: row.id,
      name: 'Migas de prueba',
      kind: 'espera',
      before: { prepTime: 36, cookTime: 605, totalTime: 641 },
      totalTime: 45,
      advancePrep: [{ text: 'Humedece el pan y déjalo reposar tapado', hoursBefore: 11 }],
      why: 'prueba',
    }
    const read = async () => (await db.select({ prepTime: recipes.prepTime, cookTime: recipes.cookTime, totalTime: recipes.totalTime, activeTime: recipes.activeTime, advancePrep: recipes.advancePrep }).from(recipes).where(eq(recipes.id, row.id)))[0]
    const lines: string[] = []

    expect(await applyTimeFixes402(db, { apply: false, fixes: [fix], log: (l) => lines.push(l) })).toEqual({ fixed: 1, skipped: 0, missing: 0 })
    expect(await read()).toMatchObject({ cookTime: 605, totalTime: 641, advancePrep: [] })
    expect(lines[0]).toContain('36 / 605 / 641 (trabajo 40) → 36 /')

    expect(await applyTimeFixes402(db, { apply: true, fixes: [fix], log: () => {} })).toEqual({ fixed: 1, skipped: 0, missing: 0 })
    const after = await read()
    expect(after).toMatchObject({ prepTime: 36, totalTime: 45, activeTime: 40, advancePrep: fix.advancePrep })
    expect(after.cookTime).toBeLessThanOrEqual(45)

    // Again: its times are no longer the audit's, so nothing moves.
    expect(await applyTimeFixes402(db, { apply: true, fixes: [fix], log: () => {} })).toEqual({ fixed: 0, skipped: 1, missing: 0 })
    expect(await read()).toEqual(after)
  })
})
