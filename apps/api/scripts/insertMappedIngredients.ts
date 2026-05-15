#!/usr/bin/env tsx
/**
 * Insert any ingredient name from `ingredient-fdc-map.yaml` that is not
 * yet in the `ingredients` table. The curator maintains the yaml; this
 * script makes sure prod has a row for every mapping. Run `seed:usda`
 * afterwards to enrich the new rows with USDA nutrition.
 *
 * Stubs carry zero nutrition + the allergen tags declared in the yaml.
 *
 * Usage:
 *   DATABASE_URL=<db> tsx scripts/insertMappedIngredients.ts            # dry-run
 *   DATABASE_URL=<db> tsx scripts/insertMappedIngredients.ts --execute  # commit
 */
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { db, pool } from '../src/db/connection.js'
import { ingredients } from '../src/db/schema.js'

const EXECUTE = process.argv.includes('--execute')

interface Mapping {
  name: string
  fdcId: number
  aisle: string | null
  density: number | null
  unitWeight: number | null
  allergenTags: string[]
}

async function main() {
  const yamlPath = path.resolve(
    import.meta.dirname,
    '..',
    'src/seed/data/ingredient-fdc-map.yaml',
  )
  const mapped = yaml.load(fs.readFileSync(yamlPath, 'utf8')) as Mapping[]

  const existing = await db.select({ name: ingredients.name }).from(ingredients)
  const have = new Set(existing.map((r) => r.name.toLowerCase()))

  const missing = mapped.filter((m) => !have.has(m.name.toLowerCase()))
  console.log(
    `Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}.  yaml=${mapped.length}, prod=${existing.length}, to-insert=${missing.length}`,
  )
  for (const m of missing) console.log(`  - ${m.name} (fdc=${m.fdcId})`)

  if (!EXECUTE) {
    console.log('\nDry-run. Re-run with --execute. Run seed:usda afterwards.')
    await pool.end()
    return
  }

  for (const m of missing) {
    await db
      .insert(ingredients)
      .values({
        name: m.name,
        fdcId: m.fdcId,
        aisle: (m.aisle as any) ?? null,
        density: m.density ?? null,
        unitWeight: m.unitWeight ?? null,
        allergenTags: m.allergenTags ?? [],
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        salt: 0,
      })
      .onConflictDoNothing()
  }
  console.log(`\nInserted ${missing.length} row(s) (stubs). Now run: pnpm seed:usda`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  pool.end()
  process.exit(1)
})
