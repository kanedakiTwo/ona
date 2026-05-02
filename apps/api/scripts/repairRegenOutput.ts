#!/usr/bin/env tsx
/**
 * Post-processor for regen output: when a recipe fails lint with
 * STEP_INGREDIENT_NOT_LISTED, parse the missing ingredient name from the
 * error, look it up in the catalog, and append a RecipeIngredient row
 * with `unit: 'al_gusto'` so the recipe passes lint.
 *
 * Curator can later promote these ad-hoc entries to real quantities via
 * the /curator dashboard.
 *
 * Usage:
 *   pnpm --filter @ona/api repair:regen
 *
 * Reads:  apps/api/scripts/output/regen-failed.jsonl
 *         apps/api/scripts/output/regen-passed.jsonl
 * Writes: regen-passed.jsonl (appended with newly-passing rows)
 *         regen-failed.jsonl (rewritten without the rows that now pass)
 *         regen-still-failed.jsonl (rows that still fail after repair)
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db, pool } from '../src/db/connection.js'
import { ingredients } from '../src/db/schema.js'
import { lintRecipe } from '../src/services/recipeLint.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'scripts/output')

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

interface FailedRow {
  recipe: any
  errors: Array<{ code: string; message: string; path?: string }>
  warnings: any[]
}

async function main() {
  // Read inputs
  const failedPath = path.join(OUT, 'regen-failed.jsonl')
  const passedPath = path.join(OUT, 'regen-passed.jsonl')
  const stillFailedPath = path.join(OUT, 'regen-still-failed.jsonl')

  const failedText = await fs.readFile(failedPath, 'utf8').catch(() => '')
  if (!failedText.trim()) {
    console.log('[repair] regen-failed.jsonl is empty — nothing to repair')
    return
  }
  const failedRows: FailedRow[] = failedText
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))

  // Build catalog index keyed by normalized name → id
  const catRows = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
  const byName = new Map<string, string>()
  for (const r of catRows) byName.set(normalize(r.name), r.id)
  console.log(`[repair] loaded ${catRows.length} catalog entries`)

  const repairedPassed: any[] = []
  const stillFailed: FailedRow[] = []

  const catalog = catRows.map((c) => ({
    id: c.id,
    name: c.name,
    allergenTags: [] as string[],
    fdcId: null as number | null,
    density: null as number | null,
    unitWeight: null as number | null,
  }))

  for (const row of failedRows) {
    const recipe = row.recipe

    // Repair 0: assign ing_<N> id to every ingredient if missing. The
    // regen LLM omits these and instead references ingredients by index
    // via step.ingredientRefs (= ['ing_0', 'ing_1', ...]).
    for (let i = 0; i < (recipe.ingredients ?? []).length; i++) {
      const ing = recipe.ingredients[i]
      if (!ing.id) ing.id = `ing_${i}`
    }

    // Re-lint upfront to find missing ingredient names, regardless of what
    // (if any) errors the row arrived with.
    const initialLint = lintRecipe(recipe, { ingredientCatalog: catalog, force: true })

    const missing: string[] = []
    for (const err of initialLint.errors ?? []) {
      if (err.code !== 'STEP_INGREDIENT_NOT_LISTED') continue
      const m = err.message.match(/menciona ["']([^"']+)["']/)
      if (m) missing.push(m[1].toLowerCase())
    }

    // Add missing ingredients to recipe.ingredients
    const existing = new Set<string>(
      (recipe.ingredients ?? [])
        .map((i: any) => i.ingredientId)
        .filter(Boolean),
    )
    let added = 0
    let nextOrder =
      (recipe.ingredients ?? []).reduce(
        (max: number, i: any) => Math.max(max, i.displayOrder ?? 0),
        -1,
      ) + 1

    for (const name of new Set(missing)) {
      const id = byName.get(normalize(name))
      if (!id) continue // ingredient unknown to catalog — give up
      if (existing.has(id)) continue
      recipe.ingredients = recipe.ingredients ?? []
      recipe.ingredients.push({
        ingredientId: id,
        quantity: 1,
        unit: 'al_gusto',
        optional: true,
        note: 'añadido automáticamente — revisar cantidad',
        displayOrder: nextOrder++,
      })
      existing.add(id)
      added++
    }

    // Always re-lint after the id assignment + ingredient additions —
    // STEP_REF_DANGLING typically resolves once we mint ing_<N> ids.

    // Resolve ORPHAN_INGREDIENT by linking to the last step. The lint
    // message names the ingredient; we look it up by name on the recipe and
    // append its `id` to the final step's `ingredientRefs`.
    for (const err of initialLint.errors) {
      if (err.code !== 'ORPHAN_INGREDIENT') continue
      const m = err.message.match(/ingrediente ["']([^"']+)["']/)
      if (!m) continue
      const orphanName = normalize(m[1])
      const orphan = (recipe.ingredients ?? []).find((i: any) => {
        const cat = catRows.find((c) => c.id === i.ingredientId)
        return cat ? normalize(cat.name) === orphanName : false
      })
      if (!orphan?.id) continue
      const lastStep = (recipe.steps ?? [])[recipe.steps.length - 1]
      if (!lastStep) continue
      lastStep.ingredientRefs = lastStep.ingredientRefs ?? []
      if (!lastStep.ingredientRefs.includes(orphan.id)) {
        lastStep.ingredientRefs.push(orphan.id)
      }
    }

    // Drop step.durationMin if TIME_INCONSISTENT was present.
    if (initialLint.errors.some((e) => e.code === 'TIME_INCONSISTENT')) {
      for (const step of recipe.steps ?? []) {
        if (step.durationMin != null) delete step.durationMin
      }
    }

    const result = lintRecipe(recipe, { ingredientCatalog: catalog, force: true })
    if (result.ok) {
      repairedPassed.push(recipe)
      console.log(`[repair] FIXED ${recipe.name} — added ${added} ingredient(s)`)
    } else {
      stillFailed.push({ recipe, errors: result.errors, warnings: result.warnings })
      console.log(
        `[repair] PARTIAL ${recipe.name} — added ${added} but still ${result.errors.length} errors`,
      )
    }
  }

  // Append repaired rows to regen-passed.jsonl
  if (repairedPassed.length > 0) {
    const lines = repairedPassed.map((r) => JSON.stringify(r)).join('\n') + '\n'
    await fs.appendFile(passedPath, lines, 'utf8')
  }
  // Rewrite still-failed and clear regen-failed
  await fs.writeFile(
    stillFailedPath,
    stillFailed.map((r) => JSON.stringify(r)).join('\n') + (stillFailed.length ? '\n' : ''),
    'utf8',
  )
  await fs.writeFile(failedPath, '', 'utf8')

  console.log('')
  console.log(`Repaired (now passing): ${repairedPassed.length}`)
  console.log(`Still failing: ${stillFailed.length}`)
  console.log(`Cleared regen-failed.jsonl. Still-failed rows in regen-still-failed.jsonl.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[repair] Fatal:', err)
    process.exit(1)
  })
  .finally(async () => {
    await pool?.end?.().catch(() => undefined)
  })
