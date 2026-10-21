/**
 * Admin «Recetas pendientes» (specs/catalog-import.md, specs/admin-dashboard.md):
 * catalogue drafts by batch, Miguel's verdict per recipe, «Publicar las
 * aprobadas» per batch, and the import of a Cocina batch file in the
 * background (checked first, then polled while it runs).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CatalogDraftDecision, CatalogDraftsView, CatalogImportCheckView, CatalogImportJobView, CatalogImportRequest } from "@ona/shared"
import { api } from "@/lib/api"

const DRAFTS_KEY = ["admin", "catalog-drafts"] as const
const JOBS_KEY = ["admin", "catalog-import", "jobs"] as const

export function useCatalogDrafts() {
  return useQuery({
    queryKey: DRAFTS_KEY,
    queryFn: () => api.get<CatalogDraftsView>("/admin/catalog-drafts"),
  })
}

export interface DraftActionAnswer {
  id: string
  name: string
  batch: string
  wishesCovered?: number
}

/** «Publicar», «Descartar» or «Recuperar» one draft. */
export function useDraftAction(kind: "publish" | "discard" | "restore") {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<DraftActionAnswer>(`/admin/catalog-drafts/${id}/${kind}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: DRAFTS_KEY })
      qc.invalidateQueries({ queryKey: ["admin", "audit-log"] })
    },
  })
}

export interface BatchPublishAnswer {
  published: number
  wishesCovered: number
  held: Array<{ id: string; name: string; reason: Exclude<CatalogDraftDecision, "publicable"> }>
}

export function usePublishBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (batch: string) => api.post<BatchPublishAnswer>(`/admin/catalog-batches/${encodeURIComponent(batch)}/publish`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: DRAFTS_KEY })
      qc.invalidateQueries({ queryKey: ["admin", "audit-log"] })
    },
  })
}

/** The latest imports; polled every 3 s while one is running. */
export function useImportJobs() {
  return useQuery({
    queryKey: JOBS_KEY,
    queryFn: () => api.get<{ jobs: CatalogImportJobView[] }>("/admin/catalog-import/jobs?limit=5"),
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.status === "running") ? 3_000 : false),
  })
}

export function useCheckImport() {
  return useMutation({
    mutationFn: (payload: CatalogImportRequest) => api.post<CatalogImportCheckView>("/admin/catalog-import/check", payload),
  })
}

export function useStartImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CatalogImportRequest) => api.post<{ job: CatalogImportJobView }>("/admin/catalog-import/jobs", payload),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: JOBS_KEY })
    },
  })
}

/** New drafts arrive while an import runs: the list follows. */
export function useRefreshDrafts() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: DRAFTS_KEY })
}
