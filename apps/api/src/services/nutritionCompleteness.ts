/**
 * PRO-176 (3) — recompute the «nutrición incompleta» mark of every recipe.
 *
 * `recipes.nutrition_incomplete` is set on save; recipes saved before the
 * column existed (or before a catalogue fix gave an ingredient its unit
 * weight / density) carry a stale mark. This runs after `db:migrate` on every
 * API boot and only touches that column — `nutrition_per_serving` and every
 * other field stay as they are. Idempotent: it writes only the recipes whose
 * mark changes. Spec: specs/nutrition.md ("Incomplete nutrition").
 */
import { eq, inArray } from 'drizzle-orm'
import { ingredients, recipeIngredients, recipes } from '../db/schema.js'
import { aggregateNutrition, type IngredientCatalogEntry } from './nutrition/aggregate.js'
import type { RecipeIngredient } from '@ona/shared'

type Db = typeof import('../db/connection.js').db

export interface CompletenessLine {
  ingredientId: string
  quantity: number
  unit: string
  note: string | null
}

/** Whether the recipe's nutrition is incomplete (pure; the flag only). */
export function recipeNutritionIncomplete(
  lines: readonly CompletenessLine[],
  catalog: Map<string, IngredientCatalogEntry>,
): boolean {
  if (lines.length === 0) return false
  return aggregateNutrition({
    // The mark doesn't depend on servings.
    servings: 1,
    ingredients: lines.map((l, i) => ({
      id: String(i),
      ingredientId: l.ingredientId,
      quantity: l.quantity,
      unit: l.unit as RecipeIngredient['unit'],
      note: l.note ?? undefined,
      optional: false,
      displayOrder: i,
    })),
    catalog,
  }).incomplete
}

export interface NutritionCompletenessResult {
  recipes: number
  incomplete: number
  changed: number
}

export async function applyNutritionCompleteness(
  db: Db,
  log: (line: string) => void = console.log,
): Promise<NutritionCompletenessResult> {
  const ingRows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      density: ingredients.density,
      unitWeight: ingredients.unitWeight,
    })
    .from(ingredients)
  const catalog = new Map<string, IngredientCatalogEntry>()
  for (const r of ingRows) {
    catalog.set(r.id, {
      id: r.id,
      name: r.name,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      salt: 0,
      density: r.density,
      unitWeight: r.unitWeight,
    })
  }

  const recipeRows = await db
    .select({ id: recipes.id, incomplete: recipes.nutritionIncomplete })
    .from(recipes)
  const lineRows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      note: recipeIngredients.note,
    })
    .from(recipeIngredients)
  const linesBy = new Map<string, CompletenessLine[]>()
  for (const l of lineRows) {
    const list = linesBy.get(l.recipeId) ?? []
    list.push(l)
    linesBy.set(l.recipeId, list)
  }

  const toTrue: string[] = []
  const toFalse: string[] = []
  let incomplete = 0
  for (const r of recipeRows) {
    const mark = recipeNutritionIncomplete(linesBy.get(r.id) ?? [], catalog)
    if (mark) incomplete++
    if (mark !== r.incomplete) (mark ? toTrue : toFalse).push(r.id)
  }

  const CHUNK = 500
  for (const [ids, value] of [[toTrue, true], [toFalse, false]] as const) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK)
      await db
        .update(recipes)
        .set({ nutritionIncomplete: value })
        .where(slice.length === 1 ? eq(recipes.id, slice[0]) : inArray(recipes.id, slice))
    }
  }

  const changed = toTrue.length + toFalse.length
  log(`[nutrition-completeness] ${incomplete} de ${recipeRows.length} receta(s) con nutrición incompleta; ${changed} marca(s) cambiada(s)`)
  return { recipes: recipeRows.length, incomplete, changed }
}
