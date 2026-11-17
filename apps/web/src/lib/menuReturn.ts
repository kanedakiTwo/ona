/**
 * «Ver receta» from the menu and back (Miguel, 2026-11-05): back on the menu,
 * on the week and the day you were looking at.
 *
 *   - /menu keeps the week in `?week=YYYY-MM-DD` and the day in `?day=0…6`
 *     (0 = lunes), both written with replaceState, so the history entry a
 *     recipe goes back to carries them.
 *   - A recipe opened from the menu carries `?desde=menu`: its back button
 *     reads «Menú» (desktop) and goes back in history, or to /menu when the
 *     link was opened cold (a new tab).
 */

export const FROM_PARAM = "desde"
export const FROM_MENU = "menu"
export const DAY_PARAM = "day"

/** Recipe detail link from the menu; `servings` is the batch the menu cooks (PRO-75). */
export function menuRecipeHref(recipeId: string, servings?: number | null): string {
  const q = new URLSearchParams()
  if (servings != null && Number.isFinite(servings)) q.set("servings", String(servings))
  q.set(FROM_PARAM, FROM_MENU)
  return `/recipes/${recipeId}?${q.toString()}`
}

/** Where a recipe's back button goes, from its own `location.search`. */
export function recipeBackTarget(search: string): { fromMenu: boolean; href: string; label: string } {
  const fromMenu = new URLSearchParams(search).get(FROM_PARAM) === FROM_MENU
  return fromMenu ? { fromMenu, href: "/menu", label: "Menú" } : { fromMenu, href: "/recipes", label: "Recetas" }
}

/** `?day=` of /menu as a day index (0 = lunes … 6), or null when absent or malformed. */
export function dayFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get(DAY_PARAM)
  if (raw == null || !/^[0-6]$/.test(raw)) return null
  return Number(raw)
}
