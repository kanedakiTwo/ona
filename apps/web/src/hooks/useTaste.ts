/**
 * «Afina tu menú» (PRO-146, specs/taste.md): status (offers, «N de 78»),
 * the verdict list for «Lo que recuerdo de ti», and the writes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { TasteNextResponse, TasteProteinGroup, TasteReason, TasteStatus, TasteVerdict, TasteVerdictRow } from "@ona/shared"

export type TasteOfferEvent = "intro_start" | "intro_later" | "card_dismiss" | "onboarding"

export function useTasteStatus(enabled = true) {
  return useQuery<TasteStatus>({
    queryKey: ["taste", "status"],
    queryFn: () => api.get<TasteStatus>("/taste/status"),
    staleTime: 30_000,
    enabled,
  })
}

export function useTasteVerdicts() {
  return useQuery<{ verdicts: TasteVerdictRow[] }>({
    queryKey: ["taste", "verdicts"],
    queryFn: () => api.get<{ verdicts: TasteVerdictRow[] }>("/taste/verdicts"),
  })
}

export function fetchTasteNext(opts: { limit: number; exclude?: string[]; avoid?: TasteProteinGroup[] }) {
  const qs = new URLSearchParams({ limit: String(opts.limit) })
  if (opts.exclude?.length) qs.set("exclude", opts.exclude.join(","))
  if (opts.avoid?.length) qs.set("avoid", opts.avoid.join(","))
  return api.get<TasteNextResponse>(`/taste/next?${qs.toString()}`)
}

export interface SavedTaste {
  ok: boolean
  facts: Array<{ key: string; value: string[]; remove?: string[] }>
}

export function postTasteVerdict(recipeId: string, verdict: TasteVerdict, reason?: TasteReason) {
  return api.post<SavedTaste>("/taste", { recipeId, verdict, ...(reason ? { reason } : {}) })
}

export function postTasteOffer(event: TasteOfferEvent) {
  return api.post("/taste/offers", { event })
}

export function postTasteFlag(group: TasteProteinGroup) {
  return api.post("/taste/flags", { group })
}

/** Change or forget one verdict from «Lo que recuerdo de ti». */
export function useChangeTasteVerdict() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, { recipeId: string; verdict: TasteVerdict | null }>({
    mutationFn: ({ recipeId, verdict }) =>
      verdict ? postTasteVerdict(recipeId, verdict) : api.delete(`/taste/${recipeId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taste"] }),
  })
}

export function useTasteOffer() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, TasteOfferEvent>({
    mutationFn: (event) => postTasteOffer(event),
    onSettled: () => qc.invalidateQueries({ queryKey: ["taste", "status"] }),
  })
}
