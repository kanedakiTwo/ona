/**
 * PRO-120: pure helpers of the web's usage events (lib/usageEvents.ts) —
 * which screen a path is, where a recipe was opened from, the sign-up step
 * names. No imports, so the API's vitest can test them.
 */

export type ClientUsageEvent = "onboarding_step" | "screen_viewed" | "recipe_viewed" | "taste_tuning" | "push_opened"
export type UsageScreen = "menu" | "lista" | "compra" | "receta" | "recetas" | "perfil" | "despensa" | "avisos" | "casa"
export type RecipeViewFrom = "menu" | "catalogo" | "mimo" | "lista" | "otro"
export type OnboardingStep = "afina" | "canal" | "hogar" | "frecuencia" | "cocina" | "tiempo" | "dieta" | "prioridad"

/** The web sign-up's numbered steps (OnboardingFlow 1…6). */
const NUMBERED_STEPS: OnboardingStep[] = ["hogar", "frecuencia", "cocina", "tiempo", "dieta", "prioridad"]

/** Pure: the step name of onboarding step 1…6. */
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
