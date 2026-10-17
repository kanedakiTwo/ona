/**
 * Smoke test against the smoke Postgres (db:seed catalogue): a catalogue batch
 * replaces by name only among system recipes, never a user's own recipe with
 * the same name (`findCatalogRecipeByName`, used by `apply:recipes`).
 *
 *   API_URL=http://localhost:8790 DATABASE_URL=… SMOKE_USER_ID=… \
 *     pnpm --filter @ona/api exec vitest run src/tests/catalogRecipeLookup.smoke.ts
 *
 * Skips when the smoke environment isn't up.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray, isNull } from 'drizzle-orm'
import { USER_ID, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { recipes } from '../db/schema.js'
import { findCatalogRecipeByName } from '../services/catalogRecipeLookup.js'

const tag = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const created: string[] = []

describe('findCatalogRecipeByName (smoke)', () => {
  afterAll(async () => {
    if (created.length > 0) await db.delete(recipes).where(inArray(recipes.id, created))
  })

  it.skipIf(!reachable || !USER_ID)('finds the system recipe and never a user recipe with the same name', async () => {
    const [system] = await db
      .select({ id: recipes.id, name: recipes.name })
      .from(recipes)
      .where(isNull(recipes.authorId))
      .limit(1)
    expect(system).toBeDefined()

    // A user's recipe with the catalogue name, and one with a name only the user has.
    const onlyMine = `Receta de usuario ${tag}`
    const mine = await db
      .insert(recipes)
      .values([
        { name: system!.name.toUpperCase(), servings: 2, authorId: USER_ID },
        { name: onlyMine, servings: 2, authorId: USER_ID },
      ])
      .returning({ id: recipes.id })
    created.push(...mine.map((r) => r.id))

    expect((await findCatalogRecipeByName(db, system!.name.toLowerCase()))?.id).toBe(system!.id)
    expect(await findCatalogRecipeByName(db, onlyMine)).toBeNull()
    // The user's rows are untouched.
    const still = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.name, onlyMine))
    expect(still).toHaveLength(1)
  })
})
