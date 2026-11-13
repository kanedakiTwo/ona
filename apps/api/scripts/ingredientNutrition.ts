#!/usr/bin/env tsx
/**
 * PRO-1125 (2): fill the nutrition of the ingredients that have none — a
 * household's «Añadir», a stub — with no API (D-156). An agent on the
 * subscription (Cocina, at night) lists them, looks each one up (BEDCA first,
 * then USDA Foundation or SR Legacy without dishes, else an estimate marked
 * «estimación») and writes a JSON; this applies it and recomputes the recipes
 * that use them, with the same calculation as `persistRecipe`.
 *
 * The same list, read-only, is GET /admin/ingredients/missing-nutrition.
 *
 * Usage:
 *   DATABASE_URL=<db> tsx scripts/ingredientNutrition.ts --list                    # the ones to fill, as a JSON to complete
 *   DATABASE_URL=<db> tsx scripts/ingredientNutrition.ts --file=<file.json>        # dry-run
 *   … --file=<file.json> --execute               # commit + recompute the recipes
 *   … --overwrite                                # also rows that already have nutrition
 *
 * File: { "<ingredient name>": { "kcal": n, "proteína": n, "hidratos": n,
 *   "grasa": n, "fibra": n, "sal": n, "fuente": "BEDCA <id>" | "USDA SR Legacy <fdcId>" | "estimación" } }
 * (per 100 g; «proteina» without the accent works too).
 */
import { readFileSync } from 'node:fs'
import { inArray } from 'drizzle-orm'
import { db, pool } from '../src/db/connection.js'
import { ingredients, recipeIngredients } from '../src/db/schema.js'
import { lacksNutrition } from '../src/services/nutrition/aggregate.js'
import { applyIngredientNutrition, parseNutritionFile } from '../src/services/nutrition/ingredientNutritionFill.js'

const EXECUTE = process.argv.includes('--execute')
const OVERWRITE = process.argv.includes('--overwrite')
const LIST = process.argv.includes('--list')
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)

async function list() {
  const missing = (await db.select().from(ingredients)).filter(lacksNutrition)
  const uses = missing.length
    ? await db
        .select({ ingredientId: recipeIngredients.ingredientId, recipeId: recipeIngredients.recipeId })
        .from(recipeIngredients)
        .where(inArray(recipeIngredients.ingredientId, missing.map((r) => r.id)))
    : []
  const template: Record<string, unknown> = {}
  for (const row of missing.sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    template[row.name] = { kcal: null, 'proteína': null, hidratos: null, grasa: null, fibra: null, sal: null, fuente: null }
    const n = new Set(uses.filter((u) => u.ingredientId === row.id).map((u) => u.recipeId)).size
    console.error(`  ${row.name.padEnd(34)} ${n} receta(s)`)
  }
  console.error(`${missing.length} ingrediente(s) sin nutrición.`)
  console.log(JSON.stringify(template, null, 2))
}

async function apply(file: string) {
  const { entries, errors } = parseNutritionFile(JSON.parse(readFileSync(file, 'utf8')))
  for (const e of errors) console.log(`  ✗ ${e}`)
  console.log(`Modo: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} · ${entries.length} entrada(s) válida(s), ${errors.length} con error`)
  const res = await applyIngredientNutrition(db, entries, { execute: EXECUTE, overwrite: OVERWRITE })
  console.log(
    `\n${EXECUTE ? 'Rellenados' : 'Se rellenarían'} ${res.filled.length}. No están en el catálogo: ${res.unknown.join(', ') || 'ninguno'}.` +
      (res.kept.length ? ` Ya tenían nutrición: ${res.kept.join(', ')}.` : '') +
      (EXECUTE ? ` Recetas recalculadas: ${res.recipes.length}.` : ''),
  )
  if (errors.length > 0) process.exitCode = 1
}

async function main() {
  const file = arg('file')
  if (LIST) await list()
  else if (file) await apply(file)
  else throw new Error('Usa --list o --file=<fichero.json> [--execute]')
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  pool.end()
  process.exit(1)
})
