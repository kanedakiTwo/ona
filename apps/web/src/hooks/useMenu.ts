import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { enqueue } from "@/lib/pwa/offlineQueue"

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
    mutationFn: async (params: { menuId: string; day: number; meal: string }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueue({
          id: crypto.randomUUID(),
          url,
          method: "PUT",
          timestamp: Date.now(),
          resourceId: `${params.menuId}-${params.day}-${params.meal}`,
        })
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("ona-queue-changed"))
        }
        // Synthetic success — the server will regenerate when online; no optimistic
        // recipe substitution since we don't have a candidate locally.
        return { offline: true } as unknown as Menu
      }

      return api.put<Menu>(url)
    },
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
    mutationFn: async (params: { menuId: string; day: number; meal: string; locked: boolean }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/lock`
      const body = { locked: params.locked }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueue({
          id: crypto.randomUUID(),
          url,
          method: "PUT",
          body,
          timestamp: Date.now(),
          resourceId: `${params.menuId}-${params.day}-${params.meal}`,
        })
        // Optimistic update: flip locked flag in cached menu
        queryClient.setQueriesData<Menu | undefined>({ queryKey: ["menu"] }, (old) => {
          if (!old || old.id !== params.menuId) return old
          const nextLocked = { ...(old.locked ?? {}) }
          const dayKey = String(params.day)
          nextLocked[dayKey] = { ...(nextLocked[dayKey] ?? {}), [params.meal]: params.locked }
          return { ...old, locked: nextLocked }
        })
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("ona-queue-changed"))
        }
        return { offline: true } as unknown as Menu
      }

      return api.put<Menu>(url, body)
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] })
    },
  })
}
