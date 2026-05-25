"use client"

import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"
import {
  getOrCreatePushSubscription,
  isWebPushSupported,
} from "@/lib/webPush"

/**
 * React hook wrapping the Web Push lifecycle for the Profile UI.
 *
 * Exposes:
 *   - `state`: 'unsupported' | 'idle' | 'subscribing' | 'subscribed' |
 *              'denied' | 'error'.
 *   - `subscribe()`: prompts permission + creates subscription + POSTs
 *                    to the API.
 *   - `unsubscribe()`: removes the local subscription AND tells the
 *                      API to delete its row.
 *   - `sendTest()`: hits `POST /push/test` so the user can verify the
 *                   pipe end-to-end without waiting for a real event.
 *
 * The VAPID public key is loaded once from `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
 * (build-time env). When absent, the hook reports `unsupported` so the
 * UI hides the button rather than crashing.
 */

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

type State =
  | "unsupported"
  | "idle"
  | "subscribing"
  | "subscribed"
  | "denied"
  | "error"

export function useWebPush() {
  const [state, setState] = useState<State>("idle")
  const [error, setError] = useState<string | null>(null)

  // Probe browser support + current subscription on mount.
  useEffect(() => {
    if (!isWebPushSupported() || !PUBLIC_KEY) {
      setState("unsupported")
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!cancelled) setState(sub ? "subscribed" : "idle")
      } catch {
        if (!cancelled) setState("idle")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const subscribe = useCallback(async () => {
    setError(null)
    setState("subscribing")
    // Per-step timeouts. We track the current `phase` so when the timeout
    // fires the visible error names the stuck phase. We also surface
    // permission / SW state inline so the user doesn't need DevTools.
    let phase: "sw-ready" | "get-existing" | "request-permission" | "subscribe" | "api-post" = "sw-ready"
    const timeoutMs = 20_000
    const withTimeout = <T>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, rej) =>
          setTimeout(() => rej(new Error(`timeout@${phase}`)), timeoutMs),
        ),
      ])
    try {
      console.log("[useWebPush] subscribe start, PUBLIC_KEY len=", PUBLIC_KEY.length)
      phase = "sw-ready"
      const reg = await withTimeout(navigator.serviceWorker.ready)
      console.log("[useWebPush] SW ready, scope=", reg.scope)
      phase = "get-existing"
      const existing = await withTimeout(reg.pushManager.getSubscription())
      if (!existing) {
        if (Notification.permission === "denied") {
          throw new Error("notifications-denied")
        }
        if (Notification.permission === "default") {
          phase = "request-permission"
          const perm = await withTimeout(Notification.requestPermission())
          if (perm !== "granted") throw new Error("notifications-denied")
        }
        phase = "subscribe"
        await withTimeout(getOrCreatePushSubscription(PUBLIC_KEY))
        console.log("[useWebPush] new subscription created")
      } else {
        console.log("[useWebPush] reusing existing subscription")
      }
      const current = (await reg.pushManager.getSubscription())!
      const subJson = current.toJSON() as {
        endpoint: string
        keys: { p256dh: string; auth: string }
      }
      phase = "api-post"
      console.log("[useWebPush] POST /push/subscribe")
      await withTimeout(
        api.post("/push/subscribe", {
          subscription: {
            endpoint: subJson.endpoint,
            keys: subJson.keys,
          },
          userAgent: navigator.userAgent.slice(0, 500),
        }),
      )
      console.log("[useWebPush] subscribed OK")
      setState("subscribed")
    } catch (err: any) {
      console.warn("[useWebPush] subscribe failed:", err, { phase })
      if (err?.message === "notifications-denied") {
        setState("denied")
        return
      }
      const swCount = (
        await navigator.serviceWorker
          .getRegistrations()
          .catch(() => [] as readonly ServiceWorkerRegistration[])
      ).length
      const perm =
        typeof Notification !== "undefined" ? Notification.permission : "n/a"
      const base = String(err?.message ?? "Error inesperado")
      setError(`${base} · phase=${phase}, permission=${perm}, sw-regs=${swCount}`)
      setState("error")
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    setError(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await sub.unsubscribe()
        await api
          .delete("/push/subscribe", { endpoint: sub.endpoint })
          .catch(() => {
            /* server-side cleanup best-effort; the row will reap itself
             * on the next failed dispatch anyway. */
          })
      }
      setState("idle")
    } catch (err: any) {
      setError(err?.message ?? "Error inesperado")
      setState("error")
    }
  }, [])

  const sendTest = useCallback(async () => {
    setError(null)
    try {
      await api.post("/push/test")
    } catch (err: any) {
      setError(err?.message ?? "Error inesperado")
    }
  }, [])

  return { state, error, subscribe, unsubscribe, sendTest }
}
