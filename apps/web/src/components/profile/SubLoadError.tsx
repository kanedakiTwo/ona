"use client"

/**
 * PRO-143: no profile sub-page stays on its loading state forever. If what it
 * needs fails, or is still not there after API_SLOW_MS (8 s), the page shows
 * «No hemos podido cargar esto» with «Reintentar» instead.
 *
 * - `useSlowLoad(loading)` — true once `loading` has lasted API_SLOW_MS.
 * - `useQueryLoad(...[queryKey, query])` — for TanStack queries: `failed`
 *   when a query with no data errored or is slow; `retry()` cancels a hung
 *   request (a plain `refetch()` would just re-await it: TanStack only
 *   cancels an in-flight fetch on refetch when there is data), refetches and
 *   restarts the clock. A query that already has data never counts as failed (a
 *   failed background refetch keeps showing what was there).
 * - `SubLoadError` — the notice, in the sub-page skin.
 */
import { useCallback, useEffect, useState } from "react"
import { RotateCw } from "lucide-react"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"
import { API_SLOW_MS } from "@ona/shared"
import { PILL_INK, SubNotice } from "@/components/profile/SubPage"

export function useSlowLoad(loading: boolean, ms: number = API_SLOW_MS): { slow: boolean; restart: () => void } {
  const [slow, setSlow] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!loading) {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), ms)
    return () => clearTimeout(timer)
  }, [loading, attempt, ms])

  const restart = useCallback(() => {
    setSlow(false)
    setAttempt((n) => n + 1)
  }, [])

  return { slow, restart }
}

interface LoadableQuery {
  data: unknown
  isPending: boolean
  isError: boolean
  isFetching: boolean
  refetch: () => Promise<unknown>
}

export function useQueryLoad(
  ...entries: Array<[QueryKey, LoadableQuery]>
): { failed: boolean; retrying: boolean; retry: () => void } {
  const queryClient = useQueryClient()
  const missingEntries = entries.filter(([, q]) => q.data === undefined)
  const missing = missingEntries.map(([, q]) => q)
  const loading = missing.some((q) => q.isPending && !q.isError)
  const { slow, restart } = useSlowLoad(loading)
  const failed = missing.some((q) => q.isError) || (loading && slow)
  const retrying = failed && missing.some((q) => q.isFetching && q.isError)

  const retry = () => {
    restart()
    for (const [queryKey, q] of missingEntries) {
      void queryClient
        .cancelQueries({ queryKey, exact: true })
        .catch(() => {})
        .then(() => q.refetch())
    }
  }

  return { failed, retrying, retry }
}

export function SubLoadError({ onRetry, retrying = false }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <div role="alert" data-testid="sub-load-error">
      <SubNotice dashed>
        <p className="font-serif-text text-[18px] italic text-ink-mid">No hemos podido cargar esto</p>
        <p className="mx-auto mt-2 max-w-[360px] text-[14px] text-ink-soft">
          Puede ser la conexión o algo nuestro; nos llega un aviso. Prueba otra vez.
        </p>
        <button type="button" onClick={onRetry} disabled={retrying} className={`${PILL_INK} mt-5`}>
          <RotateCw size={16} aria-hidden="true" className={retrying ? "animate-spin" : undefined} />
          {retrying ? "Reintentando…" : "Reintentar"}
        </button>
      </SubNotice>
    </div>
  )
}
