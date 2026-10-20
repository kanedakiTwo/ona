#!/usr/bin/env tsx
/**
 * Fill the nutrition of catalogue ingredients saved with none (no USDA id
 * and 0 kcal, protein and fat): auto-create stores a zero stub when USDA is
 * unreachable — e.g. a catalogue import run without `USDA_FDC_API_KEY`
 * (2026-10-20: 128 ingredients). Same lookup as auto-create
 * (`suggestIngredient` → `pickNutritionCandidate`: USDA, then BEDCA).
 * Allergen tags gain what the name rules infer; none is removed.
 *
 * Afterwards run `recomputeRecipeNutrition.ts --only=<ids>` with the recipe
 * ids this script prints, so their cached nutrition picks up the new values.
 *
 * Usage:
 *   DATABASE_URL=<db> USDA_FDC_API_KEY=<key> tsx scripts/refillIngredientNutrition.ts             # dry-run
 *   … --queries=<file.json>   # {"ingredient name": "english USDA query"}, better than the built-in translation
 *   … --only=<name|name>      # just these ingredients
 *   … --execute               # commit
 */
import { readFileSync } from 'node:fs'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db, pool } from '../src/db/connection.js'
import { ingredients, recipeIngredients } from '../src/db/schema.js'
import { pickNutritionCandidate, suggestIngredient } from '../src/services/ingredientAutoCreate.js'
import { inferAllergenTagsFromName } from '../src/services/nutrition/allergens.js'

const EXECUTE = process.argv.includes('--execute')
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const QUERIES: Record<string, string> = arg('queries') ? JSON.parse(readFileSync(arg('queries')!, 'utf8')) : {}
const ONLY = arg('only')?.split('|').map((s) => s.trim()).filter(Boolean) ?? null

async function main() {
  if (!process.env.USDA_FDC_API_KEY) throw new Error('Falta USDA_FDC_API_KEY')
  console.log(`Modo: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`)

  const rows = await db
    .select({ id: ingredients.id, name: ingredients.name, allergenTags: ingredients.allergenTags })
    .from(ingredients)
    .where(
      and(
        isNull(ingredients.fdcId),
        sql`coalesce(${ingredients.calories}, 0) = 0 and coalesce(${ingredients.protein}, 0) = 0 and coalesce(${ingredients.fat}, 0) = 0`,
        ONLY ? inArray(ingredients.name, ONLY) : undefined,
      ),
    )
    .orderBy(ingredients.name)

  const filled: string[] = []
  const missed: string[] = []
  for (const row of rows) {
    const query = QUERIES[row.name]
    const suggestion = await suggestIngredient(row.name, { limit: 3, query })
    const top = pickNutritionCandidate(suggestion.candidates)
    const allergens = [...new Set([...(row.allergenTags ?? []), ...inferAllergenTagsFromName(row.name)])].sort()
    if (!top) {
      missed.push(row.name)
      console.log(`  ✗ ${row.name.padEnd(34)} sin candidato («${suggestion.queryUsed}»)`)
      continue
    }
    const n = top.per100g
    console.log(
      `  ${EXECUTE ? '✓' : '·'} ${row.name.padEnd(34)} ← ${top.dataType} «${top.descriptionEs ?? top.description}» ${Math.round(n.kcal)} kcal, P ${n.proteinG} G ${n.fatG} HC ${n.carbsG}`,
    )
    filled.push(row.id)
    if (EXECUTE) {
      await db
        .update(ingredients)
        .set({
          fdcId: top.fdcId,
          calories: n.kcal,
          protein: n.proteinG,
          carbs: n.carbsG,
          fat: n.fatG,
          fiber: n.fiberG,
          salt: n.saltG,
          allergenTags: allergens,
        })
        .where(eq(ingredients.id, row.id))
    }
  }

  const recipeIds = filled.length
    ? (await db.selectDistinct({ id: recipeIngredients.recipeId }).from(recipeIngredients).where(inArray(recipeIngredients.ingredientId, filled))).map((r) => r.id)
    : []
  console.log(`\n${EXECUTE ? 'Rellenados' : 'Se rellenarían'} ${filled.length} de ${rows.length}. Sin candidato: ${missed.join(', ') || 'ninguno'}.`)
  console.log(`Recetas que los usan (${recipeIds.length}): --only=${recipeIds.join(',')}`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  pool.end()
  process.exit(1)
})
