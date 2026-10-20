import { inArray } from 'drizzle-orm'
import type { DayMenu } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { recipes } from '../db/schema.js'

/**
 * PRO-240: a recipe dish saved without `recipeName` (Mimo's freezer tápers,
 * the dishes Mimo creates as household recipes) showed «Receta» or «—» on
 * the menu. Every reader fills the name from the recipe itself.
 */

/** Recipe ids of dishes that have no name. Pure. */
export function recipeIdsWithoutName(days: unknown): string[] {
  const ids = new Set<string>()
  for (const day of Array.isArray(days) ? (days as DayMenu[]) : []) {
    if (!day || typeof day !== 'object') continue
    for (const slot of Object.values(day)) {
      for (const dish of Array.isArray(slot?.dishes) ? slot!.dishes : []) {
        if (dish?.kind === 'recipe' && dish.recipeId && !dish.recipeName?.trim()) ids.add(dish.recipeId)
      }
    }
  }
  return [...ids]
}

/** The same days with every nameless recipe dish named from `names`. Pure; never mutates. */
export function withRecipeNames<T>(days: T, names: ReadonlyMap<string, string>): T {
  if (!Array.isArray(days) || names.size === 0) return days
  return days.map((day: DayMenu) => {
    if (!day || typeof day !== 'object') return day
    const next: DayMenu = {}
    for (const [meal, slot] of Object.entries(day)) {
      next[meal] = slot && Array.isArray(slot.dishes)
        ? {
            ...slot,
            dishes: slot.dishes.map((d) =>
              d?.kind === 'recipe' && !d.recipeName?.trim() && names.has(d.recipeId) ? { ...d, recipeName: names.get(d.recipeId)! } : d,
            ),
          }
        : slot
    }
    return next
  }) as T
}

/**
 * Fill the missing names from the `recipes` table (one SELECT, only when
 * something is missing). A failed lookup never breaks the read: the days
 * come back as they were.
 */
export async function fillRecipeNames<T>(days: T, database: any = defaultDb): Promise<T> {
  const ids = recipeIdsWithoutName(days)
  if (ids.length === 0) return days
  try {
    const rows: { id: string; name: string }[] = await database
      .select({ id: recipes.id, name: recipes.name })
      .from(recipes)
      .where(inArray(recipes.id, ids))
    return withRecipeNames(days, new Map(rows.map((r) => [r.id, r.name])))
  } catch (err) {
    console.warn('[menuNames] recipe name lookup failed:', err)
    return days
  }
}
