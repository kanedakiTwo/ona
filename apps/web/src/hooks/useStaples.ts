/**
 * Household-staples hooks (PR 10B). The recurring items every fresh
 * shopping list pre-pends automatically (bread, milk, coffee…).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Aisle, BuyableUnit } from "@ona/shared"
import { api } from "@/lib/api"

export interface Staple {
  id: string
  householdId: string
  name: string
  quantity: number
  unit: BuyableUnit
  aisle: Aisle
  pricePerUnit: number | null
  active: boolean
  createdAt: string
}

export function useStaples() {
  return useQuery<Staple[]>({
    queryKey: ["staples"],
    queryFn: () => api.get<Staple[]>("/staples"),
    staleTime: 30_000,
  })
}

export function useAddStaple() {
  const qc = useQueryClient()
  return useMutation<
    Staple,
    Error,
    {
      name: string
      quantity?: number
      unit?: BuyableUnit
      aisle?: Aisle
      pricePerUnit?: number | null
    }
  >({
    mutationFn: (body) => api.post<Staple>("/staples", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staples"] }),
  })
}

export function usePatchStaple() {
  const qc = useQueryClient()
  return useMutation<
    Staple,
    Error,
    { id: string; patch: Partial<Omit<Staple, "id" | "householdId" | "createdAt">> }
  >({
    mutationFn: ({ id, patch }) => api.patch<Staple>(`/staples/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staples"] }),
  })
}

export function useDeleteStaple() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => api.delete<void>(`/staples/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staples"] }),
  })
}
