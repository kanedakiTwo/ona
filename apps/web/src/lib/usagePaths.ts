/**
 * PRO-120: pure helpers of the web's usage events (lib/usageEvents.ts) —
 * which screen a path is, where a recipe was opened from, the sign-up step
 * names. No imports, so the API's vitest can test them.
 */

export type ClientUsageEvent =
  | "onboarding_step"
  | "screen_viewed"
  | "recipe_viewed"
  | "taste_tuning"
  | "push_opened"
  | "content_shared"
  | "week_printed"
  | "handsfree_started"
export type UsageScreen =
  | "menu"
  | "lista"
  | "compra"
  | "receta"
  | "recetas"
  | "perfil"
  | "despensa"
  | "avisos"
  | "casa"
  | "ficha"
  | "afinar"
  | "historial"
  | "imprimir"
  | "recetarios"
  | "tiendas"
export type RecipeViewFrom = "menu" | "catalogo" | "mimo" | "lista" | "otro"
export type OnboardingStep = "afina" | "canal" | "hogar" | "quien_compra" | "invitar" | "frecuencia" | "cocina" | "tiempo" | "dieta" | "prioridad"

/** The web sign-up's numbered steps (OnboardingFlow 1…8; 2 and 6 not asked since 2026-11-03, 7 and 8 PRO-383, lib/onboardingSteps.ts). */
const NUMBERED_STEPS: OnboardingStep[] = ["hogar", "frecuencia", "cocina", "tiempo", "dieta", "prioridad", "quien_compra", "invitar"]

/** Pure: the step name of onboarding step 1…8. */
export function onboardingStepKey(step: number): OnboardingStep | null {
  return NUMBERED_STEPS[step - 1] ?? null
}

const RECIPE_DETAIL = /^\/recipes\/(?!new\/?$)[^/]+\/?$/

/** Pure: the screen a path is, or null (public pages, cook mode, forms…). */
export function screenOfPath(path: string | null | undefined): UsageScreen | null {
  const p = (path ?? "").replace(/\/+$/, "") || "/"
  if (p === "/menu") return "menu"
  if (p === "/shopping") return "lista"
  if (p === "/compra") return "compra"
  if (p === "/recipes") return "recetas"
  if (RECIPE_DETAIL.test(p)) return "receta"
  if (p === "/profile") return "perfil"
  if (p === "/profile/pantry") return "despensa"
  if (p === "/profile/avisos") return "avisos"
  if (p === "/profile/casa") return "casa"
  // PRO-1024 (trucos 5).
  if (p === "/profile/ficha") return "ficha"
  if (p === "/afinar") return "afinar"
  if (p === "/menu/history") return "historial"
  if (p === "/menu/imprimir") return "imprimir"
  if (p === "/profile/cookbooks" || /^\/cookbooks\/[^/]+$/.test(p)) return "recetarios"
  if (p === "/compra/tiendas") return "tiendas"
  return null
}

/** Pure: where a recipe was opened from, by the page before it (Mimo's links say so themselves). */
export function recipeFromPath(prev: string | null | undefined): RecipeViewFrom {
  const p = prev ?? ""
  if (p.startsWith("/menu")) return "menu"
  if (p === "/recipes" || p.startsWith("/recipes?") || p.startsWith("/cookbooks") || p.startsWith("/profile/cookbooks")) return "catalogo"
  if (p.startsWith("/shopping")) return "lista"
  return "otro"
}
