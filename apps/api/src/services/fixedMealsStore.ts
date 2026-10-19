/**
 * Comidas fijas (PRO-218): read and write `userSettings.template.fixedMeals`
 * without touching the rest of the profile blob. Used by Mimo's tools; the
 * profile page writes the whole blob through `PUT /user/:id/settings`.
 */
import { eq } from 'drizzle-orm'
import { fixedMealsFromTemplate, type FixedMeal, type FixedMealType } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { userSettings } from '../db/schema.js'

type Db = typeof defaultDb

export async function getFixedMeals(userId: string, db: Db = defaultDb): Promise<FixedMeal[]> {
  const [row] = await db.select({ template: userSettings.template }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
  return fixedMealsFromTemplate(row?.template)
}

/** Pure: the fixed list with `next` set for its meal (or that meal removed). */
export function withFixedMeal(list: readonly FixedMeal[], meal: FixedMealType, next: FixedMeal | null): FixedMeal[] {
  const rest = list.filter((f) => f.meal !== meal)
  return next ? [...rest, next] : rest
}

/** Set (or remove with `null`) one meal's fixed meal; returns the new list. */
export async function saveFixedMeal(userId: string, meal: FixedMealType, next: FixedMeal | null, db: Db = defaultDb): Promise<FixedMeal[]> {
  const [row] = await db.select({ id: userSettings.id, template: userSettings.template }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
  const raw = row?.template
  // Legacy array templates (DayTemplate[]) have no room for extras: keep them as `mealTemplate`-less blob.
  const blob: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
  const list = withFixedMeal(fixedMealsFromTemplate(blob), meal, next)
  blob.fixedMeals = list
  if (row) await db.update(userSettings).set({ template: blob }).where(eq(userSettings.userId, userId))
  else await db.insert(userSettings).values({ userId, template: blob })
  return list
}
