import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { enqueue } from "@/lib/pwa/offlineQueue"

interface ShoppingItem {
  id: string
  name: string
  quantity: string
  unit: string
  category: string
  checked: boolean
  inStock: boolean
}

interface ShoppingList {
  id: string
  menu_id: string
  items: ShoppingItem[]
}

export function useShoppingList(menuId: string | undefined) {
  return useQuery<ShoppingList>({
    queryKey: ["shopping-list", menuId],
    queryFn: () => api.get(`/shopping-list/${menuId}`),
    enabled: !!menuId,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}
