/**
 * Pantry hooks (PR 11) — household-shared register of what's at home.
 *
 * Auto-decrements on cook-log creation (server-side). The frontend just
 * lists + lets the user edit qty / unit / expiry manually.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { BuyableUnit } from "@ona/shared"
import { api } from "@/lib/api"

export interface PantryItem {
  id: string
  householdId: string
  ingredientId: string | null
  name: string
  quantity: number
  unit: BuyableUnit
  expiresAt: string | null
  lastUpdatedAt: string
  createdAt: string
}

export function usePantry() {
  return useQuery<PantryItem[]>({
    queryKey: ["pantry"],
    queryFn: () => api.get<PantryItem[]>("/pantry"),
    staleTime: 30_000,
  })
}

export function useAddPantry() {
  const qc = useQueryClient()
  return useMutation<
    PantryItem,
    Error,
    {
      name: string
      quantity?: number
      unit?: BuyableUnit
      ingredientId?: string | null
      expiresAt?: string | null
    }
  >({
    mutationFn: (body) => api.post<PantryItem>("/pantry", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pantry"] }),
  })
}

export function usePatchPantry() {
  const qc = useQueryClient()
  return useMutation<
    PantryItem,
    Error,
    {
      id: string
      patch: Partial<Pick<PantryItem, "name" | "quantity" | "unit" | "expiresAt">>
    }
  >({
    mutationFn: ({ id, patch }) => api.patch<PantryItem>(`/pantry/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pantry"] }),
  })
}

export function useDeletePantry() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => api.delete<void>(`/pantry/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pantry"] }),
  })
}
