"use client"

// TODO(units PR 3.5): No vitest config in apps/web. Round-trip behaviour
// (debounce + cache + API call) will be covered by a Playwright spec in PR 3.5.

import { useCallback, useRef, useState } from "react"
import { apiFetch } from "@/lib/api"
import type { ResolveResult, ResolveInput } from "@ona/shared"

interface UseUnitResolverState {
  /** Most recent resolution result, if any. */
  data?: ResolveResult
  isPending: boolean
  error?: string
}

/**
 * Calls POST /units/resolve to convert a display unit (e.g. "1 cda") to its
 * canonical (g/ml/u) form. Debounces 250 ms so typing in the unit field
 * doesn't fire a request on every keystroke. Caches by normalised
 * (displayUnit, ingredientId) for the lifetime of the form instance.
 *
 * Uses `apiFetch` directly (not `api.post`) so the AbortSignal can be
 * forwarded through — `api.post` does not accept an options argument.
 */
export function useUnitResolver() {
  const [state, setState] = useState<UseUnitResolverState>({ isPending: false })

  // Per-form-instance cache.
  // Key = `${normalised(displayUnit)}|${ingredient.id ?? ''}`
  const cacheRef = useRef<Map<string, ResolveResult>>(new Map())

  // Debounce timer + AbortController for the in-flight request.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  /**
   * Resolve a free-form display unit. Debounced 250ms; cancels superseded
   * calls. Aborted calls reject with a DOMException name=AbortError — callers
   * should ignore them. Cache hits resolve synchronously.
   */
  const resolve = useCallback(
    (input: ResolveInput): Promise<ResolveResult> => {
      const cacheKey = `${input.displayUnit.toLowerCase().trim()}|${input.ingredient?.id ?? ""}`
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        setState({ isPending: false, data: cached })
        return Promise.resolve(cached)
      }

      // Cancel any pending debounce timer and in-flight request.
      if (timerRef.current) clearTimeout(timerRef.current)
      if (abortRef.current) abortRef.current.abort()

      setState((s) => ({ ...s, isPending: true, error: undefined }))

      return new Promise<ResolveResult>((resolve_, reject) => {
        timerRef.current = setTimeout(async () => {
          const controller = new AbortController()
          abortRef.current = controller
          try {
            const result = await apiFetch<ResolveResult>("/units/resolve", {
              method: "POST",
              body: input,
              signal: controller.signal,
            })
            cacheRef.current.set(cacheKey, result)
            setState({ isPending: false, data: result })
            resolve_(result)
          } catch (err) {
            if (controller.signal.aborted) {
              // Superseded by a newer call. Clear the pending flag so the UI
              // doesn't get stuck on a spinner if every call is aborted.
              setState((s) => ({ ...s, isPending: false }))
              reject(new DOMException("Aborted", "AbortError"))
              return
            }
            const msg = err instanceof Error ? err.message : "Resolution failed"
            setState({ isPending: false, error: msg })
            reject(err)
          }
        }, 250)
      })
    },
    [],
  )

  /** Wipe the per-form cache (call on form reset/unmount if desired). */
  const clearCache = useCallback(() => {
    cacheRef.current.clear()
    setState({ isPending: false })
  }, [])

  return { ...state, resolve, clearCache }
}
