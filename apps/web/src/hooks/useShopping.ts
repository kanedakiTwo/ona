import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { Aisle, BuyableUnit } from "@ona/shared"
import { api } from "@/lib/api"
import { enqueue } from "@/lib/pwa/offlineQueue"

export interface ShoppingItem {
  id: string
  ingredientId: string | null
  name: string
  quantity: number
  unit: BuyableUnit
  aisle: Aisle
  checked: boolean
  inStock: boolean
  /** 'menu' (default for legacy rows) | 'manual' | 'staple'. PR 10. */
  kind?: 'menu' | 'manual' | 'staple'
  /** € per `unit`. Null/undefined = no price entered yet. PR 10. */
  pricePerUnit?: number | null
}

export interface ShoppingList {
  id: string
  menuId: string | null
  /** Inclusive ISO `YYYY-MM-DD` boundaries of the date range this list covers. */
  rangeStartDate: string | null
  rangeEndDate: string | null
  items: ShoppingItem[]
}

export interface ShoppingListTotal {
  totalEur: number
  pricedCount: number
  unpricedCount: number
}

/**
 * Fetch the user's rolling shopping list. Date range is optional — server
 * defaults to "today through end of next week". The list is regenerated
 * on every GET (overwriting the persisted row's items + range) so the
 * caller only needs to invalidate this query after menu mutations and
 * the next fetch reflects them.
 */
export function useShoppingList(range?: { from: string; to: string }) {
  return useQuery<ShoppingList>({
    queryKey: ["shopping-list", "rolling", range?.from ?? null, range?.to ?? null],
    queryFn: () => {
      const params = range
        ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
        : ""
      return api.get<ShoppingList>(`/shopping-list${params}`)
    },
  })
}

export function useCheckItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { listId: string; itemId: string; checked: boolean }) => {
      const url = `/shopping-list/${params.listId}/item/${params.itemId}/check`
      const body = { checked: params.checked }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueue({
          id: crypto.randomUUID(),
          url,
          method: "PUT",
          body,
          timestamp: Date.now(),
          resourceId: params.itemId,
        })
        // Optimistic cache update
        queryClient.setQueriesData<ShoppingList>({ queryKey: ["shopping-list"] }, (old) => {
          if (!old) return old
          return {
            ...old,
            items: old.items.map((it) =>
              it.id === params.itemId ? { ...it, checked: params.checked } : it
            ),
          }
        })
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("ona-queue-changed"))
        }
        return { offline: true }
      }

      return api.put(url, body)
    },
    onSuccess: (data) => {
      // State-only mutations: don't refetch (which would re-run the rolling
      // aggregation server-side and feel like a full reload). The PUT
      // already returns the updated list — slot it into every cached
      // `["shopping-list"]` query directly.
      if (data && typeof data === "object" && "items" in data) {
        queryClient.setQueriesData({ queryKey: ["shopping-list"] }, data)
      }
    },
  })
}

// ─── PR 10: manual items + prices + totals ────────────────────────────

export function useListTotal(listId: string | undefined) {
  return useQuery<ShoppingListTotal>({
    queryKey: ["shopping-list", listId, "totals"],
    queryFn: () => api.get<ShoppingListTotal>(`/shopping-list/${listId}/totals`),
    enabled: !!listId,
    staleTime: 10_000,
  })
}

export function useAddShoppingItem() {
  const qc = useQueryClient()
  return useMutation<
    ShoppingList,
    Error,
    {
      listId: string
      name: string
      quantity?: number
      unit?: BuyableUnit
      aisle?: Aisle
      pricePerUnit?: number | null
    }
  >({
    mutationFn: ({ listId, ...body }) => api.post(`/shopping-list/${listId}/items`, body),
    onSuccess: (data, vars) => {
      if (data && typeof data === "object" && "items" in data) {
        qc.setQueriesData({ queryKey: ["shopping-list"] }, data)
      }
      qc.invalidateQueries({ queryKey: ["shopping-list", vars.listId, "totals"] })
    },
  })
}

export function usePatchShoppingItem() {
  const qc = useQueryClient()
  return useMutation<
    ShoppingList,
    Error,
    {
      listId: string
      itemId: string
      patch: Partial<Pick<ShoppingItem, "name" | "quantity" | "unit" | "aisle" | "pricePerUnit">>
    }
  >({
    mutationFn: ({ listId, itemId, patch }) =>
      api.patch(`/shopping-list/${listId}/item/${itemId}`, patch),
    onSuccess: (data, vars) => {
      if (data && typeof data === "object" && "items" in data) {
        qc.setQueriesData({ queryKey: ["shopping-list"] }, data)
      }
      qc.invalidateQueries({ queryKey: ["shopping-list", vars.listId, "totals"] })
    },
  })
}

export function useDeleteShoppingItem() {
  const qc = useQueryClient()
  return useMutation<ShoppingList, Error, { listId: string; itemId: string }>({
    mutationFn: ({ listId, itemId }) =>
      api.delete(`/shopping-list/${listId}/item/${itemId}`),
    onSuccess: (data, vars) => {
      if (data && typeof data === "object" && "items" in data) {
        qc.setQueriesData({ queryKey: ["shopping-list"] }, data)
      }
      qc.invalidateQueries({ queryKey: ["shopping-list", vars.listId, "totals"] })
    },
  })
}

/**
 * @deprecated The rolling endpoint regenerates on every GET, so manual
 * regeneration isn't needed. Kept as a no-op for old callers.
 */
export function useRegenerateShoppingList() {
  return useMutation({ mutationFn: async (_listId: string) => null })
}

export function useStockItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { listId: string; itemId: string; inStock: boolean }) => {
      const url = `/shopping-list/${params.listId}/item/${params.itemId}/stock`
      const body = { inStock: params.inStock }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueue({
          id: crypto.randomUUID(),
          url,
          method: "PUT",
          body,
          timestamp: Date.now(),
          resourceId: params.itemId,
        })
        // Optimistic cache update
        queryClient.setQueriesData<ShoppingList>({ queryKey: ["shopping-list"] }, (old) => {
          if (!old) return old
          return {
            ...old,
            items: old.items.map((it) =>
              it.id === params.itemId ? { ...it, inStock: params.inStock } : it
            ),
          }
        })
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("ona-queue-changed"))
        }
        return { offline: true }
      }

      return api.put(url, body)
    },
    onSuccess: (data) => {
      // State-only mutation — slot the server response into the cache
      // rather than invalidating (which would trigger a fresh rolling
      // aggregation server-side and feel like a page reload).
      if (data && typeof data === "object" && "items" in data) {
        queryClient.setQueriesData({ queryKey: ["shopping-list"] }, data)
      }
    },
  })
}
