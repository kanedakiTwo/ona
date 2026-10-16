/**
 * «Imprimir la semana» (PRO-112, specs/menus.md): pure helpers for the print
 * view — which meal rows the week has, what each cell says, and the shopping
 * list grouped by aisle.
 */
import { AISLES, type Aisle, type ShoppingItem } from "@ona/shared"
import { DAY_MEAL_ORDER, slotMinutes, type MealKey } from "./menuDay"

type Slot = { dishes?: Array<{ kind: string; recipeName?: string | null; text?: string }> } | null | undefined
type Day = Partial<Record<MealKey, Slot>> | null | undefined

/** Meals present on any day of the week, in chronological order. */
export function printMealRows(days: Day[]): MealKey[] {
  return DAY_MEAL_ORDER.filter((m) => days.some((d) => d?.[m] != null))
}

/** One cell: the dish names (recipes and written dishes) and the minutes of the first recipe. */
export function printCell(slot: Slot): { names: string[]; minutes: number | null } {
  const names = (slot?.dishes ?? [])
    .map((d) => (d.kind === "note" ? d.text ?? "" : d.recipeName ?? ""))
    .map((s) => s.trim())
    .filter(Boolean)
  return { names, minutes: slotMinutes(slot as never) }
}

/** Shopping items still to buy (not in stock), grouped by aisle in store order; empty aisles dropped. */
export function printShoppingByAisle(items: ShoppingItem[]): Array<{ aisle: Aisle; items: ShoppingItem[] }> {
  const toBuy = items.filter((i) => !i.inStock)
  return AISLES.map((aisle) => ({
    aisle,
    items: toBuy.filter((i) => (i.aisle ?? "otros") === aisle).sort((a, b) => a.name.localeCompare(b.name, "es")),
  })).filter((g) => g.items.length > 0)
}
