/**
 * Red de tiendas v2 (specs/shop-orders.md → «Red de tiendas»): the switch,
 * the household's postal code, the once-asked choice and «Pedir».
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { RedKind, RedStatus, Shop, ShopOrder } from "@ona/shared"
import { api } from "@/lib/api"

export function useRedStatus() {
  return useQuery<RedStatus>({ queryKey: ["red-status"], queryFn: () => api.get<RedStatus>("/red/status"), staleTime: 60_000 })
}

export function useSetPostalCode() {
  const qc = useQueryClient()
  return useMutation<{ postalCode: string }, Error, { postalCode: string }>({
    mutationFn: (body) => api.put<{ postalCode: string }>("/red/postal-code", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["red-status"] })
      qc.invalidateQueries({ queryKey: ["shops"] })
    },
  })
}

export function useRedChoice() {
  const qc = useQueryClient()
  return useMutation<{ shops: Shop[] }, Error, { kind: RedKind; choice: "red" | "super"; redShopId?: string }>({
    mutationFn: (body) => api.post<{ shops: Shop[] }>("/red/choice", body),
    onSuccess: ({ shops }) => {
      qc.setQueryData(["shops"], shops)
      qc.invalidateQueries({ queryKey: ["shop-orders"] })
    },
  })
}

export function usePlaceRedOrder() {
  const qc = useQueryClient()
  return useMutation<ShopOrder, Error, { id: string; maxEur: number }>({
    mutationFn: ({ id, maxEur }) => api.post<ShopOrder>(`/shop-orders/${id}/order`, { maxEur }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shop-orders"] })
      qc.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}
