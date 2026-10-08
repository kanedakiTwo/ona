"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * Subscribe to a CSS media query. Returns `false` on the server and during
 * hydration (so the first client render matches the SSR HTML), then the
 * live value. Pages that switch structure on it should only do so once
 * their data has loaded — by then hydration is over and the value is real.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Tailwind's `lg` breakpoint (≥1024 px), where pages get their desktop layout. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)")
}
