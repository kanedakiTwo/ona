/**
 * "Compra en mis tiendas" hooks (specs/shop-orders.md): the household's
 * shops and the per-shop orders drafted from the shopping list.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { LineDecision, Shop, ShopInput, ShopOrder } from "@ona/shared"
import { api } from "@/lib/api"

export function useShops() {
  return useQuery<Shop[]>({
    queryKey: ["shops"],
    queryFn: () => api.get<Shop[]>("/shops"),
    staleTime: 30_000,
  })
}

export function useSaveShop() {
  const qc = useQueryClient()
  return useMutation<Shop, Error, { id?: string; body: ShopInput }>({
    mutationFn: ({ id, body }) => (id ? api.patch<Shop>(`/shops/${id}`, body) : api.post<Shop>("/shops", body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shops"] })
      qc.invalidateQueries({ queryKey: ["shop-orders"] })
    },
  })
}

export function useDeleteShop() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => api.delete<void>(`/shops/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shops"] })
      qc.invalidateQueries({ queryKey: ["shop-orders"] })
    },
  })
}

export function useShopOrders(includeClosed = false) {
  return useQuery<ShopOrder[]>({
    queryKey: ["shop-orders", includeClosed],
    queryFn: () => api.get<ShopOrder[]>(`/shop-orders${includeClosed ? "?all=1" : ""}`),
  })
}

export interface PrepareResult {
  orders: ShopOrder[]
  unassigned: Array<{ name: string; quantity: number; unit: string; kind: string }>
  skipped: Array<{ name: string; reason: string }>
  hasShops: boolean
}

export function usePrepareShopOrders() {
  const qc = useQueryClient()
  return useMutation<PrepareResult, Error, { days?: number }>({
    mutationFn: (body) => api.post<PrepareResult>("/shop-orders/prepare", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shop-orders"] })
      qc.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

function useOrderMutation<V>(fn: (vars: V) => Promise<ShopOrder>, alsoList = false) {
  const qc = useQueryClient()
  return useMutation<ShopOrder, Error, V>({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shop-orders"] })
      if (alsoList) qc.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

export interface LinePatch {
  key: string
  remove?: boolean
  note?: string | null
  quantity?: number
  moveToShopId?: string
}

export const usePatchShopOrder = () =>
  useOrderMutation<{ id: string; lines?: LinePatch[]; capEur?: number | null }>(({ id, ...body }) =>
    api.patch<ShopOrder>(`/shop-orders/${id}`, body),
  )

export const useMarkShopOrderSent = () => useOrderMutation<{ id: string }>(({ id }) => api.post<ShopOrder>(`/shop-orders/${id}/sent`))

export const useSubmitShopReply = () =>
  useOrderMutation<{ id: string; text: string }>(({ id, text }) => api.post<ShopOrder>(`/shop-orders/${id}/quote`, { text }))

export const useApproveShopOrder = () =>
  useOrderMutation<{ id: string; decisions: Record<string, LineDecision>; capEur?: number | null }>(({ id, ...body }) =>
    api.post<ShopOrder>(`/shop-orders/${id}/approve`, body),
  )

export const useCloseShopOrder = () =>
  useOrderMutation<{ id: string; finalTotalEur?: number | null }>(
    ({ id, finalTotalEur }) => api.post<ShopOrder>(`/shop-orders/${id}/close`, { finalTotalEur: finalTotalEur ?? null }),
    true,
  )

export const useCancelShopOrder = () => useOrderMutation<{ id: string }>(({ id }) => api.post<ShopOrder>(`/shop-orders/${id}/cancel`))
