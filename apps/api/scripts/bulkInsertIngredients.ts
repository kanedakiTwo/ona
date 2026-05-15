#!/usr/bin/env tsx
/**
 * Bulk-insert ingredient stubs from a newline-separated file of names.
 * Stubs carry zero nutrition + allergen tags inferred from the name; the
 * curator dashboard or `seed:usda` can backfill USDA data later.
 *
 * Usage:
 *   DATABASE_URL=<db> tsx scripts/bulkInsertIngredients.ts < names.txt
 */
import readline from 'node:readline'
import { db, pool } from '../src/db/connection.js'
import { ingredients } from '../src/db/schema.js'
import { inferAllergenTagsFromName } from '../src/services/nutrition/allergens.js'

async function main() {
  const names: string[] = []
  const rl = readline.createInterface({ input: process.stdin })
  for await (const line of rl) {
    const n = line.trim()
    if (n) names.push(n)
  }
  if (names.length === 0) {
    console.log('No names on stdin.')
    await pool.end()
    return
  }

  console.log(`Inserting ${names.length} stub ingredient(s)...`)
  for (const name of names) {
    const allergens = inferAllergenTagsFromName(name)
    await db
      .insert(ingredients)
      .values({
        name,
        fdcId: null,
        aisle: null,
        allergenTags: allergens,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        salt: 0,
      })
      .onConflictDoNothing()
    console.log(`  ✓ ${name}`)
  }
  console.log('Done.')
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  pool.end()
  process.exit(1)
})
