/**
 * Pure view helpers for /menu/history ("D · Luz y foto", PRO-43): each past
 * week is a card with a few `RecipeCover` thumbnails of what was planned.
 *
 * No React, no `@/` aliases: imported by the API's vitest suite
 * (`apps/api/src/tests/redesignDHistorialRecetarios.test.ts`) through a
 * relative path, so keep it dependency-free apart from `@ona/shared` types.
 */
import type { DayMenu, Dish, MealSlot, RecipeDish } from "@ona/shared"
import { DAY_MEAL_ORDER, type MealKey } from "./menuDay"

export interface WeekCover {
  recipeId: string
  name: string
  imageUrl: string | null
  meal: MealKey
}

/**
 * Distinct recipes of a week (day by day, breakfast → dinner), photos first
 * so the thumbnails read as food, capped at `max`. `total` is the number of
 * distinct recipes, for a "+N" tile.
 */
export function weekCovers(
  days: (DayMenu | undefined | null)[] | undefined | null,
  max = 4,
): { covers: WeekCover[]; total: number } {
  const seen = new Set<string>()
  const all: WeekCover[] = []
  for (const day of days ?? []) {
    if (!day) continue
    for (const meal of DAY_MEAL_ORDER) {
      const slot = day[meal] as MealSlot | undefined
      const dishes: Dish[] = slot?.dishes ?? []
      for (const d of dishes) {
        if (d.kind !== "recipe") continue
        const r = d as RecipeDish
        if (seen.has(r.recipeId)) continue
        seen.add(r.recipeId)
        all.push({ recipeId: r.recipeId, name: r.recipeName ?? "", imageUrl: r.imageUrl ?? null, meal })
      }
    }
  }
  const withPhoto = all.filter((c) => c.imageUrl)
  const without = all.filter((c) => !c.imageUrl)
  return { covers: [...withPhoto, ...without].slice(0, Math.max(0, max)), total: all.length }
}

/** "Creado el 9 de octubre de 2026" (empty string for an unreadable date). */
export function createdLabel(createdAt: string): string {
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return ""
  return `Creado el ${d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}`
}
