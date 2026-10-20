import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
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
  /** Part already bought / at home (PRO-199). */
  haveQuantity?: number
  /** Menu line left out: «No lo compro esta semana» (PRO-175). */
  skipped?: boolean
  /** Menu line with the household's own amount: what the menu asked (PRO-175). */
  menuQuantity?: number
  /** Manual line: amount in the household's words, «2 paquetes» (PRO-175). */
  amountText?: string
  /** Menu line switched to another unit: the menu's unit (PRO-292). */
  menuUnit?: BuyableUnit
  /** Menu line: the units it can be bought in, the menu's first (PRO-292). */
  unitOptions?: BuyableUnit[]
  /** Manual line typed with no amount (stored as 1 u). */
  quantitySource?: 'user' | 'default'
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
 * A mutation answers with the whole updated list. Put it only into the
 * cached rolling list it came from (same id). Writing it into every
 * `["shopping-list"]` query also overwrote other date ranges and the
 * `totals` query (2026-10-10).
 */
function putList(qc: ReturnType<typeof useQueryClient>, data: unknown) {
  if (!data || typeof data !== "object" || !("items" in data) || !("id" in data)) return
  const list = data as ShoppingList
  qc.setQueriesData<ShoppingList>({ queryKey: ["shopping-list", "rolling"] }, (old) =>
    old && old.id === list.id ? list : old,
  )
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
    // While another range loads, keep showing the previous one; the page
    // disables the row buttons until the fresh list (and its id) arrives.
    placeholderData: keepPreviousData,
    // The app default keeps data 60 s; a range seen before would come back
    // with the id of a list the server has since rebuilt. Always refetch.
    staleTime: 0,
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
        queryClient.setQueriesData<ShoppingList>({ queryKey: ["shopping-list", "rolling"] }, (old) => {
          if (!old || !Array.isArray(old.items)) return old
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
        putList(queryClient, data)
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
      amountText?: string
    }
  >({
    mutationFn: ({ listId, ...body }) => api.post(`/shopping-list/${listId}/items`, body),
    onSuccess: (data, vars) => {
      if (data && typeof data === "object" && "items" in data) {
        putList(qc, data)
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
      patch: Partial<Pick<ShoppingItem, "name" | "quantity" | "unit" | "aisle" | "pricePerUnit">> & { amountText?: string | null }
    }
  >({
    mutationFn: ({ listId, itemId, patch }) =>
      api.patch(`/shopping-list/${listId}/item/${itemId}`, patch),
    onSuccess: (data, vars) => {
      if (data && typeof data === "object" && "items" in data) {
        putList(qc, data)
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
        putList(qc, data)
      }
      qc.invalidateQueries({ queryKey: ["shopping-list", vars.listId, "totals"] })
    },
  })
}

/**
 * Change a line that comes from the menu (PRO-175): `skipped` = «No lo compro
 * esta semana» (false puts it back), `quantity` = the household's amount in
 * the line's unit (null = back to the menu's), `unit` = buy it in another
 * unit (PRO-292; the menu's unit alone goes back to the menu's amount).
 * Kept across rebuilds.
 */
export function useEditMenuLine() {
  const qc = useQueryClient()
  return useMutation<ShoppingList, Error, { listId: string; itemId: string; skipped?: boolean; quantity?: number | null; unit?: BuyableUnit }>({
    mutationFn: ({ listId, itemId, ...body }) =>
      api.put(`/shopping-list/${listId}/item/${encodeURIComponent(itemId)}/edit`, body),
    onSuccess: (data, vars) => {
      if (data && typeof data === "object" && "items" in data) putList(qc, data)
      qc.invalidateQueries({ queryKey: ["shopping-list", vars.listId, "totals"] })
    },
  })
}

/**
 * «Nos queda una cebolla» (PRO-182): how much of a menu line is at home, in
 * the line's unit. The list then buys only the rest; 0 clears it.
 */
export function useHaveAtHome() {
  const qc = useQueryClient()
  return useMutation<ShoppingList, Error, { listId: string; itemId: string; quantity: number }>({
    mutationFn: ({ listId, itemId, quantity }) =>
      api.put(`/shopping-list/${listId}/item/${encodeURIComponent(itemId)}/have`, { quantity }),
    onSuccess: (data, vars) => {
      if (data && typeof data === "object" && "items" in data) putList(qc, data)
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
        queryClient.setQueriesData<ShoppingList>({ queryKey: ["shopping-list", "rolling"] }, (old) => {
          if (!old || !Array.isArray(old.items)) return old
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
        putList(queryClient, data)
      }
    },
  })
}
