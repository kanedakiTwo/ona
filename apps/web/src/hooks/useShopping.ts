import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

interface ShoppingItem {
  id: string
  name: string
  quantity: string
  unit: string
  category: string
  checked: boolean
  in_stock: boolean
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
    mutationFn: (params: { listId: string; itemId: string; checked: boolean }) =>
      api.put(`/shopping-list/${params.listId}/item/${params.itemId}`, {
        checked: params.checked,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

export function useStockItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { listId: string; itemId: string; in_stock: boolean }) =>
      api.put(`/shopping-list/${params.listId}/item/${params.itemId}`, {
        in_stock: params.in_stock,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}
