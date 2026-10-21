"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import {
  SW_RELOAD_KEY,
  readLastReload,
  shouldCheckForUpdate,
  shouldReloadOnControllerChange,
  shouldReloadOnNavigation,
} from "@/lib/pwa/swUpdate"

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
 *
 * It also keeps the installed app current (lib/pwa/swUpdate.ts): a new
 * worker taking over an already-controlled page reloads it once, on the next
 * move inside the app (never under the person's typing), and coming back to
 * the app asks for an update (the installed app has no reload button and
 * stays open for days).
 */
export function ServiceWorkerRegistration() {
  const pathname = usePathname()
  const updatePending = useRef(false)
  const reloading = useRef(false)
  const lastPath = useRef<string | null>(null)

  // A new version is waiting: load it as the person moves to another page.
  useEffect(() => {
    const fromPath = lastPath.current
    lastPath.current = pathname
    if (!shouldReloadOnNavigation({ updatePending: updatePending.current, reloading: reloading.current, fromPath, toPath: pathname })) return
    reloading.current = true
    try {
      window.sessionStorage.setItem(SW_RELOAD_KEY, String(Date.now()))
    } catch {
      // Storage blocked: the in-page flag still prevents a second reload here.
    }
    window.location.reload()
  }, [pathname])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return
    // `next-pwa` disables itself in dev (`disable: NODE_ENV === 'development'`),
    // so /sw.js doesn't exist locally / in CI. Skip registration there to
    // keep the console clean — production / preview builds still register.
    if (process.env.NODE_ENV !== "production") return

    const sw = navigator.serviceWorker
    const hadController = Boolean(sw.controller)
    let registration: ServiceWorkerRegistration | null = null
    let lastCheckAt: number | null = null

    const onControllerChange = () => {
      const now = Date.now()
      if (!shouldReloadOnControllerChange({ hadController, reloading: reloading.current, lastReloadAt: readLastReload(window.sessionStorage), now })) return
      updatePending.current = true
    }
    const onVisibility = () => {
      const now = Date.now()
      if (!registration || !shouldCheckForUpdate(document.visibilityState, now, lastCheckAt)) return
      lastCheckAt = now
      registration.update().catch(() => {})
    }

    sw.addEventListener("controllerchange", onControllerChange)
    document.addEventListener("visibilitychange", onVisibility)

    // Defer to after first paint so we never block hydration.
    const onLoad = () => {
      sw.register("/sw.js", { scope: "/" })
        .then((reg) => {
          registration = reg
          lastCheckAt = Date.now() // registering already checked
          console.log("[sw] registered, scope=", reg.scope)
        })
        .catch((err) => {
          console.warn("[sw] register failed:", err)
        })
    }
    if (document.readyState === "complete") onLoad()
    else window.addEventListener("load", onLoad, { once: true })

    return () => {
      window.removeEventListener("load", onLoad)
      sw.removeEventListener("controllerchange", onControllerChange)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])
  return null
}
