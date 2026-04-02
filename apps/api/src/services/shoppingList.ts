import { eq, inArray } from 'drizzle-orm'
import { recipeIngredients, ingredients } from '../db/schema.js'
import { HOUSEHOLD_MULTIPLIER } from '@ona/shared'
import type { DayMenu, HouseholdSize, ShoppingItem } from '@ona/shared'
import { randomUUID } from 'crypto'

interface IngredientAccumulator {
  ingredientId: string
  name: string
  quantity: number
  unit: string
}

/**
 * Generate a shopping list from menu days.
 *
 * 1. Extract all recipe IDs from the menu
 * 2. Fetch recipe_ingredients with ingredient names
 * 3. Group by ingredient, sum quantities
 * 4. Multiply by household multiplier
 * 5. Return ShoppingItem[] with checked=false, inStock=false
 */
export async function generateShoppingList(
  menuDays: DayMenu[],
  householdSize: HouseholdSize,
  db: any,
): Promise<ShoppingItem[]> {
  // 1. Extract all recipe IDs
  const recipeIds = new Set<string>()
  for (const day of menuDays) {
    for (const meal of Object.keys(day)) {
      const slot = day[meal]
      if (slot?.recipeId) {
        recipeIds.add(slot.recipeId)
      }
    }
  }

  if (recipeIds.size === 0) return []

  // 2. Fetch recipe ingredients with ingredient names
  const rows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      ingredientName: ingredients.name,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(inArray(recipeIngredients.recipeId, [...recipeIds]))

  // Count how many times each recipe appears in the menu
  const recipeCounts = new Map<string, number>()
  for (const day of menuDays) {
    for (const meal of Object.keys(day)) {
      const slot = day[meal]
      if (slot?.recipeId) {
        recipeCounts.set(slot.recipeId, (recipeCounts.get(slot.recipeId) ?? 0) + 1)
      }
    }
  }

  // 3. Group by ingredient, sum quantities (accounting for recipe repetitions)
  const accumulated = new Map<string, IngredientAccumulator>()
  for (const row of rows) {
    const count = recipeCounts.get(row.recipeId) ?? 1
    const existing = accumulated.get(row.ingredientId)
    if (existing) {
      existing.quantity += row.quantity * count
    } else {
      accumulated.set(row.ingredientId, {
        ingredientId: row.ingredientId,
        name: row.ingredientName,
        quantity: row.quantity * count,
        unit: row.unit ?? 'g',
      })
    }
  }

  // 4. Multiply by household multiplier
  const multiplier = HOUSEHOLD_MULTIPLIER[householdSize] ?? 1

  // 5. Build ShoppingItem[]
  const items: ShoppingItem[] = []
  for (const [, item] of accumulated) {
    items.push({
      id: randomUUID(),
      ingredientId: item.ingredientId,
      name: item.name,
      quantity: Math.round(item.quantity * multiplier * 100) / 100,
      unit: item.unit,
      checked: false,
      inStock: false,
    })
  }

  // Sort by name for consistency
  items.sort((a, b) => a.name.localeCompare(b.name))

  return items
}
