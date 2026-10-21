import { api } from "@/lib/api"

/**
 * PRO-120 (specs/metrics.md «Eventos de la web»): what the web sees and the
 * API can't — sign-up steps, screens, recipes opened, «Afina tu menú» and
 * tapped notifications. Closed words only, never text. The API validates
 * every prop and keeps a screen or a step once per person and day; this file
 * stores nothing in the browser (Legal: no localStorage for analytics).
 * Fire-and-forget: it never fails the app.
 */

import {
  onboardingStepKey,
  recipeFromPath,
  screenOfPath,
  type ClientUsageEvent,
  type OnboardingStep,
  type RecipeViewFrom,
  type UsageScreen,
} from "@/lib/usagePaths"

export { onboardingStepKey, recipeFromPath, screenOfPath }
export type { ClientUsageEvent, OnboardingStep, RecipeViewFrom, UsageScreen }

function signedIn(): boolean {
  try {
    return Boolean(localStorage.getItem("ona_token"))
  } catch {
    return false
  }
}

export function trackUsage(name: ClientUsageEvent, props: Record<string, string | number | boolean>): void {
  try {
    if (typeof window === "undefined" || !signedIn()) return
    api.post("/usage/event", { name, props }).catch(() => {})
  } catch {
    /* analytics never breaks the app */
  }
}

// In memory only (gone on reload): the next recipe opened came from a Mimo link.
let nextRecipeFromMimo = false
export function markRecipeFromMimo(): void {
  nextRecipeFromMimo = true
}

/** Root layout, on every path change: the screen seen and, on a recipe, where it came from. */
export function reportPathView(path: string, prevPath: string | null): void {
  const screen = screenOfPath(path)
  if (!screen) return
  trackUsage("screen_viewed", { screen })
  if (screen === "receta") {
    trackUsage("recipe_viewed", { from: nextRecipeFromMimo ? "mimo" : recipeFromPath(prevPath) })
    nextRecipeFromMimo = false
  }
}

/** Query param the service worker adds to the URL it opens from a notification (worker/index.ts). */
export const PUSH_OPENED_PARAM = "aviso"

/**
 * Root layout, once: a notification tap opened this page (`?aviso=<kind>`) or
 * focused an open tab (a message from the service worker). Counts it and
 * takes the param out of the address bar.
 */
export function installPushOpenedReporter(): () => void {
  try {
    if (typeof window === "undefined") return () => {}
    const url = new URL(window.location.href)
    const kind = url.searchParams.get(PUSH_OPENED_PARAM)
    if (kind) {
      trackUsage("push_opened", { kind })
      url.searchParams.delete(PUSH_OPENED_PARAM)
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
    }
    const sw = navigator.serviceWorker
    if (!sw) return () => {}
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "mimoia:push-opened" && typeof e.data.kind === "string") trackUsage("push_opened", { kind: e.data.kind })
    }
    sw.addEventListener("message", onMessage)
    return () => sw.removeEventListener("message", onMessage)
  } catch {
    return () => {}
  }
}
