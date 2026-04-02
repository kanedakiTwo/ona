import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

interface MealSlot {
  recipeId: string
  recipeName?: string
}

interface DayMenu {
  [meal: string]: MealSlot | undefined
}

interface Menu {
  id: string
  userId: string
  weekStart: string
  days: DayMenu[]
  locked: Record<string, Record<string, boolean>>
  createdAt: string
}

export function useMenu(userId: string | undefined, weekStart: string | undefined) {
  return useQuery<Menu | null>({
    queryKey: ["menu", userId, weekStart],
    queryFn: async () => {
      try {
        return await api.get<Menu>(`/menu/${userId}/${weekStart}`)
      } catch (err: any) {
        if (err.message?.includes("not found") || err.message?.includes("404")) {
          return null
        }
        throw err
      }
    },
    enabled: !!userId && !!weekStart,
  })
}

export function useGenerateMenu() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { userId: string; weekStart: string }) =>
      api.post<Menu>("/menu/generate", params),
    onSuccess: (data, variables) => {
      // Set the new menu directly in cache so it renders immediately
      queryClient.setQueryData(["menu", variables.userId, variables.weekStart], data)
      // Also invalidate to ensure fresh data on next access
      queryClient.invalidateQueries({ queryKey: ["menu"] })
    },
  })
}

export function useRegenerateMeal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { menuId: string; day: number; meal: string }) =>
      api.put<Menu>(`/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`),
    onSuccess: (data) => {
      // Update cache with the returned updated menu
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] })
    },
  })
}

export function useLockMeal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { menuId: string; day: number; meal: string; locked: boolean }) =>
      api.put<Menu>(
        `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/lock`,
        { locked: params.locked }
      ),
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] })
    },
  })
}
