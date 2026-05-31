import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { enqueue } from "@/lib/pwa/offlineQueue"

interface MealSlot {
  recipeId: string
  recipeName?: string
  /** Per-slot diner override (this week only); null/undefined = household default. */
  servings?: number | null
  /** Pinned meal-type tag — matcher restricts Aleatorio/Añadir to recipes with this tag. */
  pinnedType?: string | null
  /** `'leftover'` = cloned from another slot (kind:'planned' is the default). */
  kind?: "planned" | "leftover" | null
  /** Source slot back-reference when kind === 'leftover'. */
  leftoverOf?: { day: number; meal: string } | null
  /** Hydrated by the API from recipes.image_url on every response. */
  imageUrl?: string | null
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
  /** Recipe ids vetoed this week — matcher excludes them on regen/Aleatorio/Añadir. */
  bannedRecipeIds: string[]
  /** Day indices (0-6) the user marked "sin cocinar". */
  skippedDays: number[]
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
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

export function useRegenerateMeal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      /** When provided, the server pins this recipe instead of running the matcher. */
      recipeId?: string
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueue({
          id: crypto.randomUUID(),
          url,
          method: "PUT",
          timestamp: Date.now(),
          resourceId: `${params.menuId}-${params.day}-${params.meal}`,
          // Note: offline manual swaps lose the picked recipeId for now —
          // the queue replay POSTs without a body and the server picks one.
          // Acceptable v1 trade-off; proper offline-aware queue-with-body
          // is a follow-up.
        })
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("ona-queue-changed"))
        }
        return { offline: true } as unknown as Menu
      }

      const body = params.recipeId ? { recipeId: params.recipeId } : undefined
      return api.put<Menu>(url, body)
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

/**
 * Add a meal slot the user's template didn't include (e.g. a Saturday
 * breakfast when the saved preferences say "no breakfasts"). Scoped to
 * THIS week's menu only — does not touch the profile template.
 *
 * `recipeId` optional: when omitted the server runs the matcher and picks a
 * random recipe that fits the slot. POST returns 409 if a slot for that
 * meal already exists on that day.
 */
export function useAddMealSlot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      recipeId?: string
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      const body = params.recipeId ? { recipeId: params.recipeId } : {}
      return api.post<Menu>(url, body)
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

/**
 * Remove a slot from this week's menu. The user's template is untouched;
 * regenerating or running `addMealSlot` later brings the slot back per
 * the saved preferences. Server returns 400 when the slot is locked.
 */
export function useDeleteMealSlot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { menuId: string; day: number; meal: string }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.delete<Menu>(url)
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

/**
 * Move (or swap) a slot to another day/meal in the current week. The
 * server applies the change atomically — a single jsonb update — so the
 * drag-and-drop UI in "Vista semana" doesn't have to sequence DELETE +
 * POST + re-handle locked checks on the client. Empty target → move;
 * occupied target → swap.
 */
export function useMoveMealSlot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      menuId: string
      fromDay: number
      fromMeal: string
      toDay: number
      toMeal: string
    }) => {
      return api.post<Menu>(`/menu/${params.menuId}/move-slot`, {
        fromDay: params.fromDay,
        fromMeal: params.fromMeal,
        toDay: params.toDay,
        toMeal: params.toMeal,
      })
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

/**
 * Override the diner count for a single slot in this week's menu. Pass
 * `null` to clear the override and revert to the user's household
 * default. Server rejects values outside [1, 24].
 */
export function useUpdateSlotServings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      servings: number | null
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.patch<Menu>(url, { servings: params.servings })
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

/**
 * Pin a meal-type tag (cremas, legumbres, pizza, …) onto a slot. The matcher
 * then restricts every Aleatorio / Añadir pick on this slot to recipes whose
 * `tags` includes the tag. Pass `null` to clear the pin.
 */
export function useSetSlotPinnedType() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      pinnedType: string | null
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.patch<Menu>(url, { pinnedType: params.pinnedType })
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

/**
 * Veto a recipe for the rest of the week. Idempotent: re-banning the same
 * recipe is a no-op on the server. Pair with `useUnbanRecipe` for "Levantar
 * veto" in the panel.
 */
export function useBanRecipe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { menuId: string; recipeId: string }) => {
      return api.post<Menu>(`/menu/${params.menuId}/ban`, {
        recipeId: params.recipeId,
      })
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

export function useUnbanRecipe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { menuId: string; recipeId: string }) => {
      return api.delete<Menu>(`/menu/${params.menuId}/ban/${params.recipeId}`)
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

/**
 * Clone a previous slot's recipe as today's "sobras" target. Returns 409 if
 * the target is non-empty (delete it first) and 400 if the source is itself
 * already a leftover (no chains).
 */
export function useMarkLeftover() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      menuId: string
      sourceDay: number
      sourceMeal: string
      targetDay: number
      targetMeal: string
    }) => {
      const url = `/menu/${params.menuId}/day/${params.targetDay}/leftover`
      return api.post<Menu>(url, {
        sourceDay: params.sourceDay,
        sourceMeal: params.sourceMeal,
        targetMeal: params.targetMeal,
      })
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

/**
 * Mark a whole day "sin cocinar". Empties non-locked slots and persists the
 * day index on the menu; whole-week regenerate skips the day next time. The
 * matching `useUnskipDay` only removes the flag — it does NOT auto-refill,
 * the user adds slots back manually or regenerates.
 */
export function useSkipDay() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { menuId: string; day: number }) => {
      return api.post<Menu>(`/menu/${params.menuId}/day/${params.day}/skip`)
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}

export function useUnskipDay() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { menuId: string; day: number }) => {
      return api.delete<Menu>(`/menu/${params.menuId}/day/${params.day}/skip`)
    },
    onSuccess: (data) => {
      if (data?.userId && data?.weekStart) {
        queryClient.setQueryData(["menu", data.userId, data.weekStart], data)
      }
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
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
      queryClient.invalidateQueries({ queryKey: ["menu"] }); queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}
