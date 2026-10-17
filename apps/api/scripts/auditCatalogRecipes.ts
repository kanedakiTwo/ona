#!/usr/bin/env tsx
/**
 * PRO-73 — read-only audit of the recipe catalogue: which system recipes
 * have no steps, 2 ingredients or fewer, or quantities per serving out of
 * range (main protein 80–300 g; pasta, rice or dry pulses 50–150 g). Same
 * rule the menu generator uses to skip them (services/catalogRecipeAudit.ts).
 * It never writes: the corrections are prepared by Cocina, for Miguel's OK.
 * Against a database it also lists the ingredient data that makes the cached
 * nutrition come out short (0 kcal, no unit weight, no density); that part is
 * report only, the menu generator doesn't use it.
 *
 *   DATABASE_URL=… pnpm --filter @ona/api exec tsx scripts/auditCatalogRecipes.ts [--json] [--all]
 *   pnpm --filter @ona/api exec tsx scripts/auditCatalogRecipes.ts --seed [--json] [--all]
 *   pnpm --filter @ona/api exec tsx scripts/auditCatalogRecipes.ts --fixture=src/tests/fixtures/catalog-quantities-2026-10-15.json
 *
 *   --seed       audit seed/recipes.ts instead of a database (servings 4, as db:seed writes them)
 *   --fixture=…  audit a JSON snapshot ({ name, servings, stepCount, ingredients[] }[])
 *   --all        list every recipe, not only the flagged ones
 *   --json       print JSON instead of text
 */
import { readFileSync } from 'node:fs'
import { AUDIT_ISSUE_LABEL, auditCatalogRecipe, type AuditableRecipe, type CatalogAuditResult } from '../src/services/catalogRecipeAudit.js'
import { NUTRITION_GAP_LABEL, nutritionDataGaps, type NutritionGapLine } from '../src/services/catalogNutritionGaps.js'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const listAll = argv.includes('--all')
const fixture = argv.find((a) => a.startsWith('--fixture='))?.slice('--fixture='.length)
/** Filled by fromDatabase: one line per recipe ingredient, with its catalogue data. */
let gapLines: NutritionGapLine[] = []

async function fromDatabase(): Promise<AuditableRecipe[]> {
  const { db, pool } = await import('../src/db/connection.js')
  const { recipes, recipeIngredients, recipeSteps, ingredients } = await import('../src/db/schema.js')
  const { count, eq, inArray, isNull } = await import('drizzle-orm')
  try {
    const rows = await db
      .select({ id: recipes.id, name: recipes.name, servings: recipes.servings })
      .from(recipes)
      .where(isNull(recipes.authorId))
    const ids = rows.map((r) => r.id)
    if (ids.length === 0) return []
    const lines = await db
      .select({
        recipeId: recipeIngredients.recipeId,
        name: ingredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        unitWeight: ingredients.unitWeight,
        density: ingredients.density,
        calories: ingredients.calories,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
      .where(inArray(recipeIngredients.recipeId, ids))
    const steps = await db
      .select({ recipeId: recipeSteps.recipeId, n: count() })
      .from(recipeSteps)
      .where(inArray(recipeSteps.recipeId, ids))
      .groupBy(recipeSteps.recipeId)
    const stepCount = new Map(steps.map((s) => [s.recipeId, Number(s.n)]))
    const nameById = new Map(rows.map((r) => [r.id, r.name]))
    gapLines = lines.map((l) => ({
      recipe: nameById.get(l.recipeId) ?? '',
      ingredient: l.name,
      unit: l.unit,
      calories: l.calories,
      unitWeight: l.unitWeight,
      density: l.density,
    }))
    return rows.map((r) => ({
      name: r.name,
      servings: r.servings,
      stepCount: stepCount.get(r.id) ?? 0,
      ingredients: lines.filter((l) => l.recipeId === r.id),
    }))
  } finally {
    await pool.end()
  }
}

async function fromSeed(): Promise<AuditableRecipe[]> {
  const { seedRecipes } = await import('../src/seed/recipes.js')
  return seedRecipes.map((r) => ({ name: r.name, servings: 4, stepCount: r.steps.length, ingredients: r.ingredients }))
}

function fromFixture(path: string): AuditableRecipe[] {
  return JSON.parse(readFileSync(path, 'utf8')) as AuditableRecipe[]
}

const recipes = fixture ? fromFixture(fixture) : argv.includes('--seed') ? await fromSeed() : await fromDatabase()
const results: Array<{ name: string } & CatalogAuditResult> = recipes
  .map((r) => ({ name: r.name, ...auditCatalogRecipe(r) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'))
const flagged = results.filter((r) => r.issues.length > 0)
const gaps = nutritionDataGaps(gapLines)

if (asJson) {
  console.log(JSON.stringify({ total: results.length, flagged: flagged.length, recipes: listAll ? results : flagged, ingredientGaps: gaps }, null, 2))
} else {
  console.log(`Recetas del catálogo: ${results.length}. Marcadas: ${flagged.length} (el generador de menús las salta).`)
  for (const r of listAll ? results : flagged) {
    const per = [
      r.proteinPerServingG != null ? `proteína ${r.proteinPerServingG} g/ración` : null,
      r.starchPerServingG != null ? `base ${r.starchPerServingG} g/ración` : null,
    ].filter(Boolean)
    const what = r.issues.length > 0 ? r.issues.map((i) => AUDIT_ISSUE_LABEL[i]).join('; ') : 'bien'
    console.log(`- ${r.name}: ${what}${per.length > 0 ? ` (${per.join(', ')})` : ''}`)
  }
  if (gapLines.length > 0) {
    const affected = new Set(gaps.flatMap((g) => g.recipes))
    console.log(`\nIngredientes con datos que restan nutrición: ${gaps.length} (en ${affected.size} recetas).`)
    for (const g of gaps) {
      const where = g.recipes.length > 3 ? `${g.recipes.slice(0, 3).join(', ')}… (${g.recipes.length})` : g.recipes.join(', ')
      console.log(`- ${g.ingredient}: ${g.kinds.map((k) => NUTRITION_GAP_LABEL[k]).join('; ')} — ${where}`)
    }
  }
}
