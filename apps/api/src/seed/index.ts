/**
 * Database seed.
 *
 * 1. Inserts the ingredient catalog from `seed/ingredients.ts` (unchanged).
 * 2. Inserts the v1 recipe catalog from `seed/recipes.ts`.
 *
 * The v1 recipe seed is the legacy shape (`steps: string[]`, no servings,
 * no rich step metadata). It is NOT lint-perfect — many recipes mention
 * ingredients in their step text that aren't in the ingredient list, and
 * many gramajes are calibrated for ~5–6 diners while we now mark them as
 * `servings: 4`. The real seed path going forward is the LLM regen
 * pipeline (`pnpm regen:recipes` + `pnpm apply:recipes`); this seed exists
 * so a fresh dev DB can compile + boot the app end-to-end.
 *
 * Compromises:
 *   - Promotes each `step: string` to `recipe_steps { index, text }`.
 *   - Sets `servings: 4` on every seeded recipe (v1 default — no servings field).
 *   - Adds `internalTags: ['compartida']` and removes `'compartida'` from `tags`
 *     so the public catalog never leaks the "compartida" badge.
 *   - Bypasses `lintRecipe` — the v1 catalog is known-imperfect by design.
 *     Production-quality recipes go through `apply:recipes` after curator
 *     review (which DOES run lint).
 */

import { db, pool } from '../db/connection.js'
import {
  ingredients,
  recipes,
  recipeIngredients,
  recipeSteps,
} from '../db/schema.js'
import { seedIngredients } from './ingredients.js'
import { seedRecipes, type SeedRecipe } from './recipes.js'
import { eq } from 'drizzle-orm'
import type { Meal, Season, Unit } from '@ona/shared'
import { UNITS } from '@ona/shared'

const VALID_UNITS = new Set<string>(UNITS as readonly string[])

function coerceUnit(raw: string): Unit {
  return VALID_UNITS.has(raw) ? (raw as Unit) : 'g'
}

/** Strip 'compartida' from the public tag list so it lives only in internalTags. */
function publicTags(seed: SeedRecipe): string[] {
  return (seed.tags ?? []).filter((t) => t.toLowerCase() !== 'compartida')
}

async function seed(): Promise<void> {
  console.log('Seeding database...')

  // 1. Ingredients
  console.log(`Inserting ${seedIngredients.length} ingredients...`)
  const insertedIngredients = await db
    .insert(ingredients)
    .values(seedIngredients)
    .onConflictDoNothing()
    .returning()
  console.log(`Inserted ${insertedIngredients.length} ingredients`)

  const allIngredients = await db.select().from(ingredients)
  const ingredientIdByName = new Map(allIngredients.map((i) => [i.name, i.id]))

  // 2. Recipes (legacy seed shape → new schema)
  console.log(`Inserting ${seedRecipes.length} recipes...`)
  let inserted = 0
  let skipped = 0
  let updated = 0
  for (const recipe of seedRecipes) {
    const tags = publicTags(recipe)
    const internalTags = ['compartida']
    const meals = (recipe.meals ?? []) as Meal[]
    const seasons = (recipe.seasons ?? []) as Season[]
    const prepTime = recipe.prepTime > 0 ? recipe.prepTime : null

    // Resolve every ingredient reference. Drop unmapped ingredients with a warning.
    const ingredientRows = recipe.ingredients
      .map((ri, idx) => {
        const ingredientId = ingredientIdByName.get(ri.name)
        if (!ingredientId) {
          console.warn(`  [warn] ingredient "${ri.name}" not in catalog (${recipe.name})`)
          return null
        }
        return {
          ingredientId,
          quantity: ri.quantity,
          unit: coerceUnit(ri.unit),
          displayOrder: idx,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)

    if (ingredientRows.length === 0) {
      console.warn(`  [skip] ${recipe.name}: no resolvable ingredients`)
      skipped++
      continue
    }

    // Promote string steps to recipe_steps rows.
    const stepRows = recipe.steps.map((text, index) => ({ index, text }))

    // Check for existing row by name.
    const [existing] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.name, recipe.name))
      .limit(1)

    await db.transaction(async (tx) => {
      let recipeId: string
      if (existing) {
        recipeId = existing.id
        await tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipeId))
        await tx
          .delete(recipeIngredients)
          .where(eq(recipeIngredients.recipeId, recipeId))
        await tx
          .update(recipes)
          .set({
            imageUrl: recipe.imageUrl ?? null,
            servings: 4,
            prepTime,
            meals,
            seasons,
            tags,
            internalTags,
            updatedAt: new Date(),
          })
          .where(eq(recipes.id, recipeId))
        updated++
      } else {
        const [insertedRow] = await tx
          .insert(recipes)
          .values({
            name: recipe.name,
            authorId: null,
            imageUrl: recipe.imageUrl ?? null,
            servings: 4,
            prepTime,
            meals,
            seasons,
            tags,
            internalTags,
            difficulty: 'medium',
          })
          .returning({ id: recipes.id })
        recipeId = insertedRow.id
        inserted++
      }

      if (ingredientRows.length > 0) {
        await tx.insert(recipeIngredients).values(
          ingredientRows.map((row) => ({
            recipeId,
            ingredientId: row.ingredientId,
            quantity: row.quantity,
            unit: row.unit,
            displayOrder: row.displayOrder,
          })),
        )
      }
      if (stepRows.length > 0) {
        await tx.insert(recipeSteps).values(
          stepRows.map((row) => ({
            recipeId,
            index: row.index,
            text: row.text,
          })),
        )
      }
    })
  }

  console.log(
    `Recipes: ${inserted} inserted, ${updated} updated, ${skipped} skipped (no resolvable ingredients).`,
  )
  console.log('Seed complete!')
  await pool.end()
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
