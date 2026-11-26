/**
 * «Avisos» in Perfil (PRO-237, specs/notifications.md): each alert kind,
 * where it arrives and its switch. Mimo changes the same switches.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AlertKind, AlertsOverview, AlertTimeKind, AutoplanNotice } from "@ona/shared"
import { api } from "@/lib/api"

export function useAlerts() {
  return useQuery<AlertsOverview>({
    queryKey: ["alerts"],
    queryFn: () => api.get<AlertsOverview>("/notifications/prefs"),
    staleTime: 30_000,
  })
}

export function useSetAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: { kind: AlertKind; on: boolean }) =>
      api.patch<AlertsOverview>("/notifications/prefs", { prefs: { [p.kind]: p.on } }),
    onSuccess: (data) => qc.setQueryData(["alerts"], data),
  })
}

/** PRO-1301: the household's time for the morning menu / dinner question (null = back to the default). */
export function useSetAlertTime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: { kind: AlertTimeKind; time: string | null }) =>
      api.patch<AlertsOverview>("/notifications/prefs", { times: { [p.kind]: p.time } }),
    onSuccess: (data) => qc.setQueryData(["alerts"], data),
  })
}

/** PRO-381: the card on /menu after Mimo left next week done on Thursday (null = nothing to show). */
export function useAutoplanNotice(enabled: boolean) {
  return useQuery<AutoplanNotice | null>({
    queryKey: ["autoplan-notice"],
    queryFn: async () => (await api.get<{ notice?: AutoplanNotice | null }>("/menu/autoplan"))?.notice ?? null,
    enabled,
    staleTime: 60_000,
  })
}

/** The person opened that week: the card goes for good. */
export function useAutoplanViewed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (weekStart: string) => api.post<{ ok: boolean }>("/menu/autoplan/viewed", { weekStart }),
    onSuccess: () => qc.setQueryData(["autoplan-notice"], null),
  })
}
