/**
 * Cook-log hooks (PR 6). The household-scoped tally that powers the
 * "Cocinada X veces · última: dd mmm" badge on recipe cards + the
 * "Esto lo cocinamos" button on meal cards.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface CookLogStats {
  count: number
  lastCookedAt: string | null
}

export interface CookLogRow {
  id: string
  userId: string
  recipeId: string
  menuId: string | null
  dayIndex: number | null
  meal: string | null
  cookedAt: string
  durationMin: number | null
  notes: string | null
}

export interface RecordCookBody {
  recipeId: string
  menuId?: string | null
  dayIndex?: number | null
  meal?: string | null
  durationMin?: number | null
  notes?: string | null
  cookedAt?: string
}

/** Times-cooked + last-cooked for a single recipe in household scope. */
export function useRecipeCookStats(recipeId: string | undefined) {
  return useQuery<CookLogStats>({
    queryKey: ["cook-logs", "recipe", recipeId],
    queryFn: () => api.get<CookLogStats>(`/cook-logs/recipe/${recipeId}`),
    enabled: !!recipeId,
    staleTime: 30_000,
  })
}

/** Append a cook event; invalidates the recipe's stats + the recent list. */
export function useRecordCook() {
  const qc = useQueryClient()
  return useMutation<{ id: string }, Error, RecordCookBody>({
    mutationFn: (body) => api.post<{ id: string }>("/cook-logs", body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["cook-logs", "recipe", variables.recipeId] })
      qc.invalidateQueries({ queryKey: ["cook-logs", "recent"] })
    },
  })
}

/** Recent rows for the analytics / history strip. */
export function useRecentCookLogs(limit = 50) {
  return useQuery<CookLogRow[]>({
    queryKey: ["cook-logs", "recent", limit],
    queryFn: () => api.get<CookLogRow[]>(`/cook-logs?limit=${limit}`),
    staleTime: 30_000,
  })
}

/** Hard delete a cook log row. */
export function useDeleteCookLog() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; recipeId?: string }>({
    mutationFn: ({ id }) => api.delete<void>(`/cook-logs/${id}`),
    onSuccess: (_void, vars) => {
      qc.invalidateQueries({ queryKey: ["cook-logs", "recent"] })
      if (vars.recipeId) qc.invalidateQueries({ queryKey: ["cook-logs", "recipe", vars.recipeId] })
    },
  })
}
