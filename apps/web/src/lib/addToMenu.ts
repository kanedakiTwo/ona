/**
 * Pure helpers for "Añadir al menú" on the recipe detail (PRO-04).
 *
 * No React, no `@/` aliases: imported by the API's vitest suite
 * (`apps/api/src/tests/addToMenuSlots.test.ts`) through a relative path.
 */
import type { Menu } from "@ona/shared"
import { firstRecipeDish } from "./menuDay"

/** The sheet offers the two main meals of each day. */
export const ADD_TO_MENU_MEALS = ["lunch", "dinner"] as const
export type AddToMenuMeal = (typeof ADD_TO_MENU_MEALS)[number]

/**
 * - `add`: the day has no such slot → `POST …/meal/:meal { recipeId }`
 * - `replace`: the slot exists (empty or with a dish) → `PUT …/meal/:meal { recipeId }`
 * - `already`: the slot already holds this recipe (nothing to do)
 * - `locked`: the slot is fixed ("Fijada"); it can't change from here
 */
export type AddToMenuAction = "add" | "replace" | "already" | "locked"

export interface AddToMenuSlot {
  day: number
  meal: AddToMenuMeal
  action: AddToMenuAction
  /** Name of the recipe the slot holds today, if any. */
  current: string | null
}

export function addToMenuSlots(menu: Menu, recipeId: string): AddToMenuSlot[] {
  const out: AddToMenuSlot[] = []
  for (let day = 0; day < 7; day++) {
    for (const meal of ADD_TO_MENU_MEALS) {
      const slot = menu.days[day]?.[meal]
      const dish = firstRecipeDish(slot)
      const current = dish?.recipeName ?? null
      let action: AddToMenuAction
      if (menu.locked?.[String(day)]?.[meal]) action = "locked"
      else if (!slot) action = "add"
      else if (dish?.recipeId === recipeId) action = "already"
      else action = "replace"
      out.push({ day, meal, action, current })
    }
  }
  return out
}

/** Local-time Monday of `d` as `YYYY-MM-DD` (the menu's `weekStart`). */
export function mondayOf(d: Date): string {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`
}
