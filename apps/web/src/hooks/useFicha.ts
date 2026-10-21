/**
 * «Tu ficha» (PRO-318) — TanStack hooks over the API of PRO-317
 * (`routes/householdProfile.ts`, specs/household-profile.md → «Tu ficha»).
 *
 * Every action invalidates the whole `["ficha"]` family (view, history, «¿Por
 * qué lo sé?») and the memory (`["memory"]`): what the ficha changes about the
 * reader or the household is mirrored to `user_memories`, which
 * /profile/memoria reads.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { FICHA_PATH, type FichaChangeView, type FichaView, type FichaWhyView } from "@ona/shared"

export const FICHA_KEY = ["ficha"] as const
export const FICHA_VIEW_KEY = ["ficha", "view"] as const

function invalidateFicha(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: FICHA_KEY })
  void qc.invalidateQueries({ queryKey: ["memory"] })
}

export function useFicha() {
  return useQuery<FichaView>({
    queryKey: FICHA_VIEW_KEY,
    queryFn: () => api.get<FichaView>(FICHA_PATH),
    // 403 (a `child` member) and 404 (no household) are answers, not hiccups.
    retry: (count, err) => {
      const status = (err as { status?: number })?.status
      return status !== 403 && status !== 404 && count < 2
    },
  })
}

/** «¿Por qué lo sé?» for one fact; idle while `factId` is null. */
export function useFichaWhy(factId: string | null) {
  return useQuery<FichaWhyView>({
    queryKey: ["ficha", "why", factId],
    queryFn: () => api.get<FichaWhyView>(`${FICHA_PATH}/facts/${factId}/why`),
    enabled: !!factId,
  })
}

/** «Lo que ha cambiado»: the history the reader may see, newest first. */
export function useFichaChanges(days = 60) {
  return useQuery<FichaChangeView[]>({
    queryKey: ["ficha", "changes", days],
    queryFn: () => api.get<FichaChangeView[]>(`${FICHA_PATH}/changes?days=${days}`),
  })
}

/** «Así es». */
export function useConfirmFact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (factId: string) => api.post<{ ok: true }>(`${FICHA_PATH}/facts/${factId}/confirm`),
    onSuccess: () => invalidateFicha(qc),
  })
}

/** «Corregir»: the reader's words (+ until when). `kind: 'note'` = kept as a note in their words. */
export function useCorrectFact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { factId: string; text: string; validUntil: string | null }) =>
      api.post<{ kind: "value" | "note" }>(`${FICHA_PATH}/facts/${input.factId}/correct`, { text: input.text, validUntil: input.validUntil }),
    onSuccess: () => invalidateFicha(qc),
  })
}

/** «Olvidar». */
export function useForgetFact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (factId: string) => api.delete<void>(`${FICHA_PATH}/facts/${factId}`),
    onSuccess: () => invalidateFicha(qc),
  })
}

/** The pending question: «Sí» / «No» / «Ahora no». */
export function useAnswerQuestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { questionId: string; answer: "yes" | "no" | "later" }) =>
      api.post<{ ok: true }>(`${FICHA_PATH}/questions/${input.questionId}`, { answer: input.answer }),
    onSuccess: () => invalidateFicha(qc),
  })
}

/** «Aprender de lo que hago» (per person): `paused` true stops learning about the reader. */
export function useSetLearningPaused() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paused: boolean) => api.put<{ paused: boolean }>(`${FICHA_PATH}/learning`, { paused }),
    onSuccess: (out) => {
      qc.setQueryData<FichaView>(FICHA_VIEW_KEY, (prev) => (prev ? { ...prev, learningPaused: out.paused } : prev))
      invalidateFicha(qc)
    },
  })
}

export interface FichaPersonInput {
  alias: string
  ageBand: string
}

/** «+ Persona»: someone of the house without an account (a minor only with a generic alias: the API says why). */
export function useAddPerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: FichaPersonInput) => api.post<{ id: string; alias: string; ageBand: string }>(`${FICHA_PATH}/persons`, input),
    onSuccess: () => invalidateFicha(qc),
  })
}

export function useUpdatePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: FichaPersonInput & { id: string }) =>
      api.patch<{ id: string; alias: string; ageBand: string }>(`${FICHA_PATH}/persons/${input.id}`, { alias: input.alias, ageBand: input.ageBand }),
    onSuccess: () => invalidateFicha(qc),
  })
}

/** «Quitar de la casa»: the person and what the ficha knew about them. */
export function useRemovePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (personId: string) => api.delete<void>(`${FICHA_PATH}/persons/${personId}`),
    onSuccess: () => invalidateFicha(qc),
  })
}

/** «Deshacer» something Mimo did (409 when the fact has moved on since). */
export function useUndoChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (changeId: string) => api.post<{ ok: true }>(`${FICHA_PATH}/changes/${changeId}/undo`),
    onSuccess: () => invalidateFicha(qc),
    onError: () => invalidateFicha(qc),
  })
}

/**
 * «Descargar mi ficha» (right of access): the export, fetched with the
 * session, saved as `mi-ficha-mimoia-AAAA-MM-DD.json` (the API's own name).
 */
export async function downloadFicha(): Promise<void> {
  const data = await api.get<{ exportedAt?: string }>(`${FICHA_PATH}/export`)
  const day = (data?.exportedAt ?? new Date().toISOString()).slice(0, 10)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `mi-ficha-mimoia-${day}.json`
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2_000)
}
