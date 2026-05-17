/**
 * One-off prod-maintenance script that backfills the MEAL_TYPE_TAGS taxonomy
 * onto the existing system catalog so the "pin meal type to a slot" PR 5
 * feature has something to match against.
 *
 * Heuristics by name + ingredient signal (NO LLM — deterministic, idempotent):
 *
 *   cremas        recipe name starts with "Crema " or "Vichy"
 *   legumbres     name OR top ingredients mention legumbre keywords
 *                 (lentejas, garbanzos, alubias, fabes, judías, frijoles,
 *                  soja, guisantes secos)
 *   pizza         name contains "Pizza"
 *   asiatico      name OR ingredients carry asian markers (curry, ramen,
 *                 wok, soja, tofu, miso, thai, tailandés, asiático,
 *                 sushi, onigirazu, pollo agridulce, pekinesa)
 *   mediterraneo  name OR ingredients carry mediterranean markers (pasta
 *                 is excluded → goes in 'pasta'; arroz excluded → 'arroz';
 *                 paella, fideuá, gazpacho, ensalada caprese, pesto,
 *                 berenjenas con chermoula, shakshuka)
 *   ensalada      name starts with "Ensalada" or "Tabulé"
 *   parrilla      name contains "Brasa", "Parrilla", "Alitas a la barbacoa"
 *   batch-cooking name carries "cocido", "lentejas", "fabada", "pisto",
 *                 "estofado", "ragout", "asado al horno"
 *   pasta         name has "pasta", "espaguet", "lasaña", "macarrones",
 *                 "fideuá"
 *   arroz         name has "arroz" or main ingredient is "arroz"
 *
 * Tags compose — Paella is `arroz` AND `mediterraneo` AND `batch-cooking`.
 * Recipes that match no rule get no new tag.
 *
 * Dry-run by default; `--execute` writes. Idempotent: re-running on
 * already-tagged rows is a no-op.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx scripts/tagRecipesByType.ts          # dry-run preview
 *   npx tsx scripts/tagRecipesByType.ts --execute
 */
import { eq, sql } from 'drizzle-orm'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, pool } from '../src/db/connection.js'
import { recipes, recipeIngredients, ingredients } from '../src/db/schema.js'
import { MEAL_TYPE_TAGS, type MealTypeTag } from '@ona/shared'

const execute = process.argv.includes('--execute')

interface RecipeWithIng {
  id: string
  name: string
  tags: string[]
  ingredientNames: string[]
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

function inferTags(r: RecipeWithIng): MealTypeTag[] {
  const name = norm(r.name)
  const ing = r.ingredientNames.map(norm).join(' ')
  const both = `${name} ${ing}`
  const out = new Set<MealTypeTag>()

  // Pasta (check before mediterraneo so pasta dishes don't double-tag both).
  if (
    /\bpasta\b|\bespaguet|\blasan|\bmacarron|\bfideua|\bpenne|\bravioli|\bnoquis|\bcanelones|\bcarbonara\b/.test(name)
  ) {
    out.add('pasta')
  }

  // Arroz — name signal first, then top ingredient. Paella + risotto land here.
  if (/\barroz\b|\bpaella\b|\brisotto\b|\bonigirazu\b|sushi\b/.test(name)) {
    out.add('arroz')
  }

  // Cremas — name starts with "Crema " or "Vichy"
  if (/^crema |^vichy|gazpacho\b/.test(name)) out.add('cremas')

  // Legumbres
  if (
    /\blenteja|\bgarbanzo|\balubia|\bfabe|\bjudia|\bfrijol|\bguisante seco|tofu|edamame\b/.test(both)
  ) {
    out.add('legumbres')
  }

  // Pizza
  if (/\bpizza\b/.test(name)) out.add('pizza')

  // Asiatico
  if (
    /\bcurry\b|\bramen\b|\bwok\b|\btofu\b|\bmiso\b|thai\b|tailandes|asiatico|\bsushi\b|\bonigirazu\b|pekines|agridulce|sat[aeé]y|sat[aeé]/.test(both)
  ) {
    out.add('asiatico')
  }

  // Mediterraneo — broad catch-all signals; many recipes pair with arroz/pasta/legumbres
  if (
    /\bpaella\b|fideua\b|\bgazpacho\b|\bsalmorejo\b|chermoula|shakshuka|caprese|\bpesto\b|\bhumus\b|\bfattush\b|tzatziki|tabule\b|tagine|tajin|berenjena/.test(name)
  ) {
    out.add('mediterraneo')
  }

  // Ensalada
  if (/^ensalada|tabule\b/.test(name)) out.add('ensalada')

  // Parrilla / brasa. Word boundaries so "sobrasada" doesn't matche "brasa"
  // and "quesadillas" doesn't matche "asada".
  if (/\bparrilla\b|\bbrasa\b|\bbarbacoa\b|\basad[oa]\b/.test(name)) out.add('parrilla')

  // Batch cooking — slow-cook one-pot meals; people typically cook these in
  // bulk on a Sunday and eat them across the week.
  if (
    /\bcocido\b|\bfabada\b|\bpisto\b|\bestofad|\bguisad|\bragout\b|\bcalder[oa]\b|\bal horno\b|\blentej|\bgarbanzo|\bcurry\b|\bdal\b/.test(name)
  ) {
    out.add('batch-cooking')
  }

  return [...out]
}

async function main() {
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY-RUN (use --execute to commit)'}`)

  // Pull every system recipe with its top ingredients.
  const rows = await db
    .select({ id: recipes.id, name: recipes.name, tags: recipes.tags })
    .from(recipes)
    .where(sql`${recipes.authorId} IS NULL`)
    .orderBy(recipes.name)

  const ingRows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      name: ingredients.name,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))

  const ingByRecipe = new Map<string, string[]>()
  for (const r of ingRows) {
    const list = ingByRecipe.get(r.recipeId) ?? []
    list.push(r.name)
    ingByRecipe.set(r.recipeId, list)
  }

  let changed = 0
  let unchanged = 0
  let untagged = 0
  const previewLines: string[] = []

  for (const recipe of rows) {
    const existingTags = recipe.tags ?? []
    const inferred = inferTags({
      id: recipe.id,
      name: recipe.name,
      tags: existingTags,
      ingredientNames: ingByRecipe.get(recipe.id) ?? [],
    })

    // Merge: keep every existing tag (don't strip user-added or system tags),
    // add any inferred meal-type tag that isn't already there.
    const next = new Set<string>(existingTags)
    let added: string[] = []
    for (const t of inferred) {
      if (!next.has(t)) {
        next.add(t)
        added.push(t)
      }
    }

    if (added.length === 0) {
      if (inferred.length === 0) untagged++
      else unchanged++
      continue
    }
    changed++
    previewLines.push(
      `  + ${recipe.name.padEnd(40)} → ${added.join(', ')}`,
    )

    if (execute) {
      await db
        .update(recipes)
        .set({ tags: [...next] })
        .where(eq(recipes.id, recipe.id))
    }
  }

  console.log(`\n${previewLines.length === 0 ? 'No changes.' : 'Changes:'}\n${previewLines.join('\n')}`)
  console.log(
    `\nSummary: ${changed} updated, ${unchanged} already complete, ${untagged} no tag match — out of ${rows.length} system recipes.`,
  )
  console.log(
    execute
      ? '\nCommitted.'
      : '\nDry-run only — re-run with --execute to commit.',
  )

  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end().catch(() => {})
  process.exit(1)
})
