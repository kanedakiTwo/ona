import { count, eq, inArray } from 'drizzle-orm'
import type { Course } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { recipes, recipeIngredients, recipeSteps, ingredients } from '../db/schema.js'
import { visibleAuthorIds, visibleRecipeWhere } from './recipeVisibility.js'
import type { RecipeWithIngredients } from './recipeMatcher.js'
import { catalogAuditIssuesFor } from './catalogRecipeAudit.js'
import { isRetiredRecipe } from './recipeCatalogOrder.js'

export type RecipeWithCourse = RecipeWithIngredients & { course: Course | null }

/**
 * Every recipe the user may be served, shaped for the matcher: the weekly
 * generator, single-slot regenerations (menus.ts) and the assistant's swap
 * all load through here, so they apply the same filters (fit maps,
 * frequency, equipment, prep time, allergens).
 *
 * Visibility: catalogue + the user's and their household's own recipes —
 * never other users' private recipes (specs/recipes.md).
 * Allergens: the recipe's union plus each ingredient's catalogue tags, so
 * the restriction check doesn't depend on a stale recipe-level union.
 * Retired catalogue recipes (PRO-140) are never picked or suggested.
 */
export async function loadMatchableRecipes(userId: string, db: any = defaultDb): Promise<RecipeWithCourse[]> {
  const allRecipes = (await db.select().from(recipes).where(visibleRecipeWhere(await visibleAuthorIds(userId, db)))).filter(
    (r: any) => !isRetiredRecipe(r),
  )

  const recipeIds = allRecipes.map((r: any) => r.id)
  if (recipeIds.length === 0) return []

  const riRows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      ingredientName: ingredients.name,
      allergenTags: ingredients.allergenTags,
      unitWeight: ingredients.unitWeight,
      density: ingredients.density,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(inArray(recipeIngredients.recipeId, recipeIds))

  // Step counts for the catalogue quality audit (PRO-73).
  const stepRows = await db
    .select({ recipeId: recipeSteps.recipeId, n: count() })
    .from(recipeSteps)
    .where(inArray(recipeSteps.recipeId, recipeIds))
    .groupBy(recipeSteps.recipeId)
  const stepCountByRecipe = new Map<string, number>(stepRows.map((r: any) => [r.recipeId, Number(r.n)]))

  const auditLinesByRecipe = new Map<string, Array<{ name: string; quantity: number; unit: string; unitWeight: number | null; density: number | null }>>()
  const ingredientsByRecipe = new Map<string, RecipeWithIngredients['ingredients']>()
  for (const row of riRows) {
    const lines = auditLinesByRecipe.get(row.recipeId) ?? []
    lines.push({ name: row.ingredientName, quantity: row.quantity, unit: row.unit ?? 'g', unitWeight: row.unitWeight ?? null, density: row.density ?? null })
    auditLinesByRecipe.set(row.recipeId, lines)
    const list = ingredientsByRecipe.get(row.recipeId) ?? []
    list.push({
      ingredientId: row.ingredientId,
      ingredientName: row.ingredientName,
      quantity: row.quantity,
      unit: row.unit ?? 'g',
      allergenTags: row.allergenTags ?? [],
    })
    ingredientsByRecipe.set(row.recipeId, list)
  }

  return allRecipes.map((r: any) => ({
    id: r.id,
    name: r.name,
    meals: r.meals ?? [],
    seasons: r.seasons ?? [],
    // Three-state fit maps (migration 0024); legacy rows have null and the
    // matcher derives 'perfect' from the array tagging.
    mealFit: r.mealFit ?? undefined,
    seasonFit: r.seasonFit ?? undefined,
    // Frequency hint (migration 0026). Null = 'normal'.
    frequency: r.frequency ?? null,
    tags: r.tags ?? [],
    equipment: r.equipment ?? [],
    prepTime: r.prepTime ?? null,
    cookTime: r.cookTime ?? null,
    activeTime: r.activeTime ?? null,
    totalTime: r.totalTime ?? null,
    allergens: r.allergens ?? [],
    // Course classification for multi-dish slot building (starter/main/dessert).
    course: (r.course as Course | null | undefined) ?? null,
    ingredients: ingredientsByRecipe.get(r.id) ?? [],
    // PRO-73: catalogue recipes with no steps, too few ingredients or
    // quantities out of range are skipped by the matcher. Computed here, on
    // read; nothing is written. Users' own recipes are never audited.
    catalogAuditIssues: catalogAuditIssuesFor(r.authorId, {
      name: r.name,
      servings: r.servings ?? 4,
      stepCount: stepCountByRecipe.get(r.id) ?? 0,
      ingredients: auditLinesByRecipe.get(r.id) ?? [],
    }),
  }))
}
