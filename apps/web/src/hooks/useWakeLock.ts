"use client"

import { useEffect, useRef } from "react"

/**
 * Acquire a `screen` Wake Lock for the lifetime of the calling component.
 *
 * - Acquired on mount, released on unmount (the cooking-mode exit path).
 * - Re-acquires automatically when the tab becomes visible again.
 * - Releases the sentinel if the tab has been hidden for more than 30s
 *   (matches the spec's "backgrounding > 30s" rule).
 * - Tolerates failure silently — older browsers and Firefox simply do
 *   nothing and the rest of the cooking-mode UX still works.
 */
export function useWakeLock(active: boolean = true): void {
  // We keep the sentinel + the hidden-since timestamp on a ref so the
  // visibility listener can read them without re-subscribing.
  const sentinelRef = useRef<WakeLockSentinel | null>(null)
  const hiddenSinceRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) return
    if (typeof navigator === "undefined") return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wl: { request?: (kind: "screen") => Promise<WakeLockSentinel> } | undefined =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).wakeLock

    let cancelled = false

    async function acquire() {
      if (!wl?.request) return
      try {
        const sentinel = await wl.request("screen")
        if (cancelled) {
          // Component unmounted while we were awaiting; release immediately.
          sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
      } catch {
        // user gesture missing / API rejected — silently degrade.
      }
    }

    async function release() {
      const s = sentinelRef.current
      sentinelRef.current = null
      if (!s) return
      try {
        await s.release()
      } catch {
        // already released
      }
    }

    function onVisibilityChange() {
      if (typeof document === "undefined") return
      if (document.visibilityState === "visible") {
        const hiddenAt = hiddenSinceRef.current
        hiddenSinceRef.current = null
        // Always try to re-acquire when we come back to the foreground:
        // the browser releases the screen lock on tab-hide automatically.
        acquire()
        // (If we'd been hidden > 30s we already released proactively;
        // re-acquiring is correct on return either way.)
        void hiddenAt
      } else {
        hiddenSinceRef.current = Date.now()
        // Schedule a release after 30s if we're still hidden.
        window.setTimeout(() => {
          if (
            hiddenSinceRef.current != null &&
            Date.now() - hiddenSinceRef.current >= 30_000 &&
            document.visibilityState !== "visible"
          ) {
            release()
          }
        }, 30_500)
      }
    }

    acquire()
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibilityChange)
      release()
    }
  }, [active])
}
