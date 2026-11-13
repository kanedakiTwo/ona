/** Cook mode link, with the menu slot it cooks when there is one (specs/cook-now.md). */
export interface CookMenuContext {
  menuId: string
  day: number
  meal: string
}

const MEALS = ["breakfast", "lunch", "snack", "dinner"]

export function cookHref(recipeId: string, servings: number, ctx?: CookMenuContext | null): string {
  const q = new URLSearchParams({ servings: String(servings) })
  if (ctx) {
    q.set("menu", ctx.menuId)
    q.set("day", String(ctx.day))
    q.set("meal", ctx.meal)
  }
  return `/recipes/${recipeId}/cook?${q.toString()}`
}

export function menuContextFromSearch(search: string): CookMenuContext | null {
  const q = new URLSearchParams(search)
  const menuId = q.get("menu")
  const rawDay = q.get("day")
  const day = Number(rawDay)
  const meal = q.get("meal") ?? ""
  if (!menuId || rawDay == null || !Number.isInteger(day) || day < 0 || day > 6 || !MEALS.includes(meal)) return null
  return { menuId, day, meal }
}
