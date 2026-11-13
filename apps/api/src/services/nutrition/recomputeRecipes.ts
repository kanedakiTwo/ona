/**
 * Recompute the cached nutrition of the recipes that use some ingredients,
 * after their per-100 g values (or edible share) change: the admin remap
 * (PRO-1125), the nutrition fill (`scripts/ingredientNutrition.ts`) and the
 * edible-fraction boot step (PRO-194).
 *
 * Same calculation as `persistRecipe`: `aggregateNutrition` with each line's
 * note (frying oil counts only what is absorbed) and the recipe's servings.
 * Writes `nutrition_per_serving` and `nutrition_incomplete` only; allergens
 * and every other field stay as they are.
 *
 * Spec: ../../../../../specs/nutrition.md ("Recompute after a catalogue change")
 */
import { eq, inArray } from 'drizzle-orm'
import { ingredients, recipeIngredients, recipes } from '../../db/schema.js'
import { aggregateNutrition, catalogEntryFromRow, type IngredientCatalogEntry } from './aggregate.js'
import type { NutritionPerServing, RecipeIngredient } from '@ona/shared'

type Db = typeof import('../../db/connection.js').db

export interface RecomputedRecipe {
  id: string
  name: string
  kcalBefore: number | null
  kcalAfter: number
  incomplete: boolean
}

/** Recompute `nutrition_per_serving` + `nutrition_incomplete` of the recipes that use these ingredients. */
export async function recomputeRecipesUsing(db: Db, ingredientIds: readonly string[]): Promise<RecomputedRecipe[]> {
  if (ingredientIds.length === 0) return []
  const uses = await db
    .selectDistinct({ recipeId: recipeIngredients.recipeId })
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.ingredientId, [...ingredientIds]))
  const recipeIds = uses.map((u) => u.recipeId)
  if (recipeIds.length === 0) return []

  const lines = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      note: recipeIngredients.note,
    })
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.recipeId, recipeIds))
  const usedIds = [...new Set(lines.map((l) => l.ingredientId))]
  const ingRows = await db.select().from(ingredients).where(inArray(ingredients.id, usedIds))
  const catalog = new Map<string, IngredientCatalogEntry>()
  for (const r of ingRows) catalog.set(r.id, catalogEntryFromRow(r))

  const recipeRows = await db
    .select({ id: recipes.id, name: recipes.name, servings: recipes.servings, nutrition: recipes.nutritionPerServing })
    .from(recipes)
    .where(inArray(recipes.id, recipeIds))
  const out: RecomputedRecipe[] = []
  for (const r of recipeRows) {
    const ings = lines.filter((l) => l.recipeId === r.id)
    if (ings.length === 0 || !(r.servings > 0)) continue
    const agg = aggregateNutrition({
      servings: r.servings,
      ingredients: ings.map((l, i) => ({
        id: String(i),
        ingredientId: l.ingredientId,
        quantity: l.quantity,
        unit: l.unit as RecipeIngredient['unit'],
        note: l.note ?? undefined,
        optional: false,
        displayOrder: i,
      })),
      catalog,
    })
    await db
      .update(recipes)
      .set({ nutritionPerServing: agg.perServing, nutritionIncomplete: agg.incomplete })
      .where(eq(recipes.id, r.id))
    out.push({
      id: r.id,
      name: r.name,
      kcalBefore: (r.nutrition as NutritionPerServing | null)?.kcal ?? null,
      kcalAfter: agg.perServing.kcal,
      incomplete: agg.incomplete,
    })
  }
  return out
}
