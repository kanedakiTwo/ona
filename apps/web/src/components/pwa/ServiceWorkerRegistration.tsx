"use client"

import { useEffect } from "react"

/**
 * Manually register the service worker on every page load.
 *
 * `next-pwa` 5.6 with the App Router doesn't auto-inject the
 * registration script the way it did with the Pages Router — the SW
 * file is generated at `/sw.js`, but nothing ever calls
 * `navigator.serviceWorker.register('/sw.js')`. Result: `sw-regs=0`
 * forever, `navigator.serviceWorker.ready` hangs, and every Web Push
 * subscribe attempt times out at the `sw-ready` phase.
 *
 * This component mounts once at the root layout, calls register, and
 * gets out of the way. Idempotent — calling register with the same
 * URL on subsequent loads just hands back the existing registration.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return
    // `next-pwa` disables itself in dev (`disable: NODE_ENV === 'development'`),
    // so /sw.js doesn't exist locally / in CI. Skip registration there to
    // keep the console clean — production / preview builds still register.
    if (process.env.NODE_ENV !== "production") return
    // Defer to after first paint so we never block hydration.
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          console.log("[sw] registered, scope=", reg.scope)
        })
        .catch((err) => {
          console.warn("[sw] register failed:", err)
        })
    }
    if (document.readyState === "complete") {
      onLoad()
    } else {
      window.addEventListener("load", onLoad, { once: true })
      return () => window.removeEventListener("load", onLoad)
    }
  }, [])
  return null
}
