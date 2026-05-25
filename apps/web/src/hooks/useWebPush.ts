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
    // Hard timeout: if any step hangs (typically `pushManager.subscribe`
    // when the browser silently rejects the VAPID key), we want a
    // visible error after 20s instead of a permanently-greyed button.
    const timeoutMs = 20_000
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("subscribe-timeout-20s")), timeoutMs),
    )
    try {
      console.log("[useWebPush] subscribe start, PUBLIC_KEY len=", PUBLIC_KEY.length)
      const sub = await Promise.race([
        getOrCreatePushSubscription(PUBLIC_KEY),
        timeout,
      ])
      console.log("[useWebPush] got subscription")
      const subJson = sub.toJSON() as {
        endpoint: string
        keys: { p256dh: string; auth: string }
      }
      console.log("[useWebPush] POST /push/subscribe")
      await Promise.race([
        api.post("/push/subscribe", {
          subscription: {
            endpoint: subJson.endpoint,
            keys: subJson.keys,
          },
          userAgent: navigator.userAgent.slice(0, 500),
        }),
        timeout,
      ])
      console.log("[useWebPush] subscribed OK")
      setState("subscribed")
    } catch (err: any) {
      console.warn("[useWebPush] subscribe failed:", err)
      if (err?.message === "notifications-denied") {
        setState("denied")
      } else {
        setError(err?.message ?? "Error inesperado")
        setState("error")
      }
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
