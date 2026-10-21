#!/usr/bin/env tsx
/**
 * PRO-268 — read-only list of the catalogue recipes whose steps name meat,
 * fish, shellfish or an allergen that isn't in their ingredients («Lentejas
 * guisadas»: «añadir chorizo y morcilla», «añadir huesos y pimentón» with
 * none of them listed). The diet and allergen filters read the ingredients,
 * so such a recipe can reach a home without pork or a vegetarian one. The
 * list goes to Cocina, which proposes the fixes in batches for Miguel's OK.
 * Changes nothing: it reads and writes a report.
 *
 *   pnpm --filter @ona/api exec tsx scripts/auditStepDietMentions.ts                    # from the seed files, no DB
 *   DATABASE_URL=… pnpm --filter @ona/api exec tsx scripts/auditStepDietMentions.ts --from=db
 *
 *   --from=seed|db  seed (default): the recipes with steps of `src/seed/recipes.ts`, with
 *                   every ingredient line as written (`db:seed` drops the lines whose
 *                   ingredient isn't in `src/seed/ingredients.ts`); db: the catalogue
 *                   recipes (author_id NULL, drafts included) of DATABASE_URL — the
 *                   real catalogue, which the seed files only partly reflect.
 *   --out=…         folder for the report (default scripts/output): writes
 *                   pasos-sin-ingrediente-<fecha>.md and .json
 *
 * Two lists: (1) diet and allergens (`unlistedDietMentions`, the reviewer's
 * STEP_DIET_INGREDIENT_NOT_LISTED); (2) any other catalogue ingredient the
 * steps name and the recipe doesn't list (the reviewer's
 * STEP_INGREDIENT_NOT_LISTED, e.g. «pimentón»), for the same pass of Cocina.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditStepMentions, renderStepMentionsReport, type AuditRecipe } from '../src/services/stepDietMentionsAudit.js'

const argv = process.argv.slice(2)
const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const from = flag('from') === 'db' ? 'db' : 'seed'
const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(flag('out') ?? path.join(here, 'output'))

async function fromSeed(): Promise<{ recipes: AuditRecipe[]; catalog: string[] }> {
  const { seedRecipes } = await import('../src/seed/recipes.js')
  const { seedIngredients } = await import('../src/seed/ingredients.js')
  const recipes = seedRecipes
    .filter((r) => r.steps.length > 0)
    .map((r) => ({ name: r.name, status: 'semilla', ingredients: r.ingredients.map((i) => i.name), steps: r.steps }))
  // The seed catalogue is small; the names the seed recipes use count as catalogue too.
  const catalog = [...seedIngredients.map((i) => i.name), ...recipes.flatMap((r) => r.ingredients)]
  return { recipes, catalog }
}

async function fromDb(): Promise<{ recipes: AuditRecipe[]; catalog: string[] }> {
  const { db, pool } = await import('../src/db/connection.js')
  const { sql } = await import('drizzle-orm')
  try {
    const rows = await db.execute(sql`
      SELECT r.id, r.name, r.status,
        COALESCE((SELECT json_agg(i.name ORDER BY ri.display_order) FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = r.id), '[]') AS ingredients,
        COALESCE((SELECT json_agg(s.text ORDER BY s.index) FROM recipe_steps s WHERE s.recipe_id = r.id), '[]') AS steps
      FROM recipes r WHERE r.author_id IS NULL ORDER BY r.name`)
    const cat = await db.execute(sql`SELECT name FROM ingredients`)
    const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])
    const catList = (cat as unknown as { rows?: unknown[] }).rows ?? (cat as unknown as unknown[])
    return {
      recipes: (list as Array<{ id: string; name: string; status: string; ingredients: string[]; steps: string[] }>).map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        ingredients: r.ingredients,
        steps: r.steps,
      })),
      catalog: (catList as Array<{ name: string }>).map((c) => c.name),
    }
  } finally {
    await pool.end()
  }
}

async function main() {
  const { recipes, catalog } = from === 'db' ? await fromDb() : await fromSeed()
  const result = auditStepMentions(recipes, catalog)
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
  const source = from === 'db' ? 'base de datos (DATABASE_URL), recetas del catálogo' : 'ficheros de semilla (src/seed/recipes.ts)'
  mkdirSync(outDir, { recursive: true })
  const md = path.join(outDir, `pasos-sin-ingrediente-${date}.md`)
  const json = path.join(outDir, `pasos-sin-ingrediente-${date}.json`)
  writeFileSync(md, renderStepMentionsReport(result, { date, source }))
  writeFileSync(json, JSON.stringify({ date, source, ...result }, null, 2) + '\n')
  console.log(`${result.checked} recetas revisadas: ${result.diet.length} con carne, pescado, marisco o alérgenos en los pasos que no están en los ingredientes (${result.diet.reduce((n, r) => n + r.mentions.length, 0)} menciones); ${result.other.length} con otros ingredientes sin listar.`)
  console.log(`Informe: ${md}\nDatos:   ${json}`)
}

main().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})
