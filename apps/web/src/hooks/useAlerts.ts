/**
 * «Avisos» in Perfil (PRO-237, specs/notifications.md): each alert kind,
 * where it arrives and its switch. Mimo changes the same switches.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AlertKind, AlertsOverview } from "@ona/shared"
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
