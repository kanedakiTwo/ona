#!/usr/bin/env tsx
/**
 * One-off: detect ingredient names referenced by `seedRecipes` that are
 * not yet in the `ingredients` table, and insert them. Try USDA for
 * nutrition; fall back to a zero-nutrition stub on any failure. This is
 * needed because `seed/ingredients.ts` is older than `seed/recipes.ts`
 * and the seed silently skips any recipe whose ingredients can't all be
 * resolved.
 *
 * Usage:
 *   DATABASE_URL=<db> tsx scripts/fillSeedCatalogGap.ts           # dry-run
 *   DATABASE_URL=<db> tsx scripts/fillSeedCatalogGap.ts --execute # commit
 */
import { db, pool } from '../src/db/connection.js'
import { seedRecipes } from '../src/seed/recipes.js'
import { ingredients as ingredientsTable } from '../src/db/schema.js'
import { suggestIngredient } from '../src/services/ingredientAutoCreate.js'
import { inferAllergenTagsFromName } from '../src/services/nutrition/allergens.js'

const EXECUTE = process.argv.includes('--execute')

async function main() {
  const existing = await db.select({ name: ingredientsTable.name }).from(ingredientsTable)
  const have = new Set(existing.map((r) => r.name.toLowerCase()))

  const needed = new Set<string>()
  for (const r of seedRecipes) {
    for (const i of r.ingredients) needed.add(i.name.toLowerCase())
  }

  const missing = [...needed].filter((n) => !have.has(n)).sort()
  console.log(
    `Catalog: ${existing.length}. Seed references: ${needed.size}. Missing: ${missing.length}.`,
  )
  if (missing.length === 0) {
    await pool.end()
    return
  }

  for (const name of missing) console.log(`  - ${name}`)

  if (!EXECUTE) {
    console.log('\nDry-run. Re-run with --execute to insert.')
    await pool.end()
    return
  }

  console.log('\nResolving via USDA + inserting (one by one)...')
  let ok = 0
  let stub = 0
  for (const name of missing) {
    let fdcId: number | null = null
    let n = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, saltG: 0 }
    try {
      const s = await suggestIngredient(name, { limit: 3 })
      const top =
        s.candidates.find((c) => c.dataType === 'Foundation' || c.dataType === 'SR Legacy') ??
        s.candidates[0]
      if (top) {
        fdcId = top.fdcId
        n = top.per100g
      }
    } catch (err: any) {
      console.warn(`  [usda-fail] ${name}: ${err?.message ?? err}`)
    }
    const allergens = inferAllergenTagsFromName(name)
    await db
      .insert(ingredientsTable)
      .values({
        name,
        fdcId,
        aisle: null,
        allergenTags: allergens,
        calories: n.kcal,
        protein: n.proteinG,
        carbs: n.carbsG,
        fat: n.fatG,
        fiber: n.fiberG,
        salt: n.saltG,
      })
      .onConflictDoNothing()
    if (fdcId) ok++
    else stub++
    console.log(`  ✓ ${name} (${fdcId ? `fdc=${fdcId}, ${n.kcal} kcal/100g` : 'stub'})`)
  }
  console.log(`\nDone. ${ok} via USDA, ${stub} stub. Re-run pnpm db:seed to recover recipes.`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  pool.end()
  process.exit(1)
})
