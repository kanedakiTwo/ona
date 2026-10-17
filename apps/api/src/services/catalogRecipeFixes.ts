/**
 * PRO-78 — data fix for «Arroz al caldero» in existing catalogues.
 *
 * The system recipe was seeded with only «Arroz, Ajo» (the Notion original
 * lists ñoras, fish stock, sea bass, alioli, tomato paste, garlic and rice),
 * so no diet or allergy filter could see that it carries fish and it kept
 * reaching vegetarian weeks. `seed/recipes.ts` now has the full list; this
 * fix brings staging and production in line.
 *
 * It only touches the system recipe (`author_id IS NULL`) named «Arroz al
 * caldero» while its ingredients are still exactly arroz + ajo. Anything
 * else (user copies, a recipe someone already edited, a second run) is left
 * as is: idempotent. Missing ingredients are created from their
 * `seed/ingredients.ts` entry (nutrition, aisle, allergen tags), the same
 * values a fresh `db:seed` inserts. Recipe allergens and cached nutrition
 * are recomputed for that recipe only.
 *
 * Runs by itself after `db:migrate` (every API boot) and at the end of
 * `db:seed`, like the PRO-57 source-link backfill.
 */

import { and, eq, isNull } from 'drizzle-orm'
import type { Unit } from '@ona/shared'
import { ingredients, recipeIngredients, recipes } from '../db/schema.js'
import { seedIngredients } from '../seed/ingredients.js'
import { seedRecipes } from '../seed/recipes.js'
import { normalizeRecipeName } from './catalogSourceLinks.js'
import { aggregateNutrition, type IngredientCatalogEntry } from './nutrition/aggregate.js'
import { allergenUnion } from './nutrition/allergens.js'

export const ARROZ_AL_CALDERO = 'Arroz al caldero'

/** The ingredient list the seed (and so this fix) gives «Arroz al caldero». */
export function arrozAlCalderoIngredients(): ReadonlyArray<{ name: string; quantity: number; unit: Unit }> {
  const seed = seedRecipes.find((r) => r.name === ARROZ_AL_CALDERO)
  if (!seed) throw new Error(`seed recipe «${ARROZ_AL_CALDERO}» not found`)
  return seed.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit as Unit }))
}

/** Pure: does a recipe with these ingredient names still need the fix? Only the broken «Arroz, Ajo». */
export function needsArrozCalderoFix(ingredientNames: readonly string[]): boolean {
  const names = ingredientNames.map(normalizeRecipeName)
  if (names.length !== 2) return false
  const set = new Set(names)
  return set.size === 2 && set.has('arroz') && set.has('ajo')
}

export interface CatalogRecipeFixResult {
  /** System recipes named «Arroz al caldero». */
  found: number
  fixed: number
  /** Ingredients created because the catalogue didn't have them. */
  createdIngredients: string[]
}

type Db = typeof import('../db/connection.js').db

export async function applyCatalogRecipeFixes(
  db: Db,
  log: (line: string) => void = console.log,
): Promise<CatalogRecipeFixResult> {
  const result: CatalogRecipeFixResult = { found: 0, fixed: 0, createdIngredients: [] }

  const systemRecipes = await db
    .select({ id: recipes.id, name: recipes.name, servings: recipes.servings })
    .from(recipes)
    .where(isNull(recipes.authorId))
  const targets = systemRecipes.filter((r) => normalizeRecipeName(r.name) === normalizeRecipeName(ARROZ_AL_CALDERO))
  result.found = targets.length
  if (targets.length === 0) {
    log(`[catalog-recipe-fixes] «${ARROZ_AL_CALDERO}»: no está en el catálogo, nada que hacer`)
    return result
  }

  const pending: typeof targets = []
  for (const r of targets) {
    const rows = await db
      .select({ name: ingredients.name })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
      .where(eq(recipeIngredients.recipeId, r.id))
    if (needsArrozCalderoFix(rows.map((x) => x.name))) pending.push(r)
  }
  if (pending.length === 0) {
    log(`[catalog-recipe-fixes] «${ARROZ_AL_CALDERO}»: ya tiene sus ingredientes, nada que hacer`)
    return result
  }

  const wanted = arrozAlCalderoIngredients()

  // Resolve each ingredient by name (accent/case-insensitive); create the
  // missing ones from their seed entry.
  const findAll = async () => {
    const all = await db.select().from(ingredients)
    return new Map(all.map((i) => [normalizeRecipeName(i.name), i]))
  }
  let byName = await findAll()
  for (const w of wanted) {
    const key = normalizeRecipeName(w.name)
    if (byName.has(key)) continue
    const def = seedIngredients.find((s) => normalizeRecipeName(s.name) === key)
    if (!def) throw new Error(`ingredient «${w.name}» missing from the catalogue and from seed/ingredients.ts`)
    await db.insert(ingredients).values(def).onConflictDoNothing()
    result.createdIngredients.push(w.name)
  }
  if (result.createdIngredients.length > 0) byName = await findAll()

  const resolved = wanted.map((w, displayOrder) => {
    const ing = byName.get(normalizeRecipeName(w.name))
    if (!ing) throw new Error(`ingredient «${w.name}» could not be resolved`)
    return { ing, quantity: w.quantity, unit: w.unit, displayOrder }
  })

  const nutritionCatalog = new Map<string, IngredientCatalogEntry>()
  const allergenCatalog = new Map<string, { allergenTags?: string[] | null }>()
  for (const { ing } of resolved) {
    nutritionCatalog.set(ing.id, {
      id: ing.id,
      name: ing.name,
      calories: ing.calories ?? 0,
      protein: ing.protein ?? 0,
      carbs: ing.carbs ?? 0,
      fat: ing.fat ?? 0,
      fiber: ing.fiber ?? 0,
      salt: ing.salt ?? 0,
      density: ing.density,
      unitWeight: ing.unitWeight,
    })
    allergenCatalog.set(ing.id, { allergenTags: ing.allergenTags ?? [] })
  }

  for (const r of pending) {
    const rows = resolved.map((x) => ({
      recipeId: r.id,
      ingredientId: x.ing.id,
      quantity: x.quantity,
      unit: x.unit,
      displayOrder: x.displayOrder,
    }))
    const agg = aggregateNutrition({
      servings: r.servings || 4,
      ingredients: rows.map((row, i) => ({ id: String(i), ingredientId: row.ingredientId, quantity: row.quantity, unit: row.unit })) as any,
      catalog: nutritionCatalog,
    })
    const allergens = allergenUnion(rows, allergenCatalog)

    await db.transaction(async (tx) => {
      // Re-check inside the transaction: never a user recipe, never a recipe
      // whose ingredients changed since the read.
      const current = await tx
        .select({ name: ingredients.name })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
        .where(eq(recipeIngredients.recipeId, r.id))
      if (!needsArrozCalderoFix(current.map((x) => x.name))) return
      await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, r.id))
      await tx.insert(recipeIngredients).values(rows)
      await tx
        .update(recipes)
        .set({ allergens, nutritionPerServing: agg.perServing, nutritionIncomplete: agg.incomplete, updatedAt: new Date() })
        .where(and(eq(recipes.id, r.id), isNull(recipes.authorId)))
      result.fixed++
    })
  }

  const allergens = allergenUnion(resolved.map((x) => ({ ingredientId: x.ing.id })), allergenCatalog)
  log(
    `[catalog-recipe-fixes] «${ARROZ_AL_CALDERO}»: ${result.fixed} receta(s) corregida(s), alérgenos: ${allergens.join(', ') || 'ninguno'}` +
      (result.createdIngredients.length > 0 ? `; ingredientes nuevos: ${result.createdIngredients.join(', ')}` : ''),
  )
  return result
}
