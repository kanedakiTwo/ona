import { useQuery, useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query"
import { api, ApiError } from "@/lib/api"
import { enqueue } from "@/lib/pwa/offlineQueue"
import type { MenuFit, WeekPlan } from "@ona/shared"
import {
  addDishIn,
  addSlotIn,
  lockIn,
  moveSlotIn,
  patchDishIn,
  patchSlotIn,
  pickRecipeIn,
  removeDishIn,
  removeSlotIn,
  type OptimisticMenu,
  type RecipeLook,
} from "@/lib/menuOptimistic"

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
  /** «Cuánto ha acertado» (PRO-155): set when the week was generated; null without it. */
  fit?: MenuFit | null
  createdAt: string
}

export function useMenu(userId: string | undefined, weekStart: string | undefined) {
  return useQuery<Menu | null>({
    queryKey: ["menu", userId, weekStart],
    queryFn: async () => {
      try {
        return await api.get<Menu>(`/menu/${userId}/${weekStart}`)
      } catch (err) {
        // Only a real 404 means "no menu this week". Anything else (500,
        // offline, timeout) stays an error: the page must not mistake it
        // for an empty week and create one on top of the real menu.
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    enabled: !!userId && !!weekStart,
  })
}

/**
 * Every change of a week's dishes is one queue (`scope`): it is drawn at once
 * (`optimistic`), but the requests reach the server one after the other. Two
 * at once (a recipe and then a note, 2026-11-10) each read the week and wrote
 * it back, and the second wiped out the first.
 */
const MENU_CHANGE = { mutationKey: ["menu-change"], scope: { id: "menu-change" } } as const

/**
 * After a change: the server's week (when the route returns it) and a fresh
 * read — but only once the queue is empty, or the answer to the first change
 * would paint over the ones still on their way (they're on screen already).
 */
function settleMenu(queryClient: QueryClient, data: unknown) {
  // This change still counts as pending while its onSuccess runs.
  if (queryClient.isMutating({ mutationKey: MENU_CHANGE.mutationKey }) > 1) return
  const m = data as { userId?: string; weekStart?: string } | null | undefined
  if (m?.userId && m?.weekStart) queryClient.setQueryData(["menu", m.userId, m.weekStart], data)
  queryClient.invalidateQueries({ queryKey: ["menu"] })
  queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
}

/** Fired when a change shown at once had to be undone: the page says so. */
export const MENU_CHANGE_FAILED_EVENT = "ona:menu-change-failed"

/** Name and photo of a recipe the page already has (the picker's list, `["recipes", …]`). */
function recipeLook(queryClient: QueryClient, id: string): RecipeLook {
  for (const [, data] of queryClient.getQueriesData<unknown>({ queryKey: ["recipes"] })) {
    if (!Array.isArray(data)) continue
    const r = data.find((x) => x && typeof x === "object" && (x as { id?: string }).id === id) as
      | { id: string; name?: string; imageUrl?: string | null }
      | undefined
    if (r) return { id, name: r.name, imageUrl: r.imageUrl ?? null }
  }
  return { id }
}

/**
 * The change on screen at once (2026-11-10, Miguel: «tardan mucho en
 * mostrarse»): before the request goes out, the cached week gets `apply`
 * (lib/menuOptimistic.ts); if the API fails it goes back as it was and the
 * page says so. A refetch in flight is cancelled so it can't paint the old
 * week over it. `apply` returning null leaves the week alone (e.g. «al azar»,
 * whose dish only the server knows).
 */
function optimistic<V>(
  queryClient: QueryClient,
  apply: (menu: OptimisticMenu, v: V) => OptimisticMenu | null,
) {
  return {
    onMutate: async (v: V & { menuId: string }) => {
      await queryClient.cancelQueries({ queryKey: ["menu"] })
      const snapshot = queryClient.getQueriesData<unknown>({ queryKey: ["menu"] })
      queryClient.setQueriesData<unknown>({ queryKey: ["menu"] }, (old: unknown) => {
        const m = old as OptimisticMenu | null | undefined
        if (!m || typeof m !== "object" || m.id !== v.menuId || !Array.isArray(m.days)) return old
        return apply(m, v) ?? old
      })
      return { snapshot }
    },
    onError: (_err: unknown, _v: V & { menuId: string }, ctx: { snapshot: [QueryKey, unknown][] } | undefined) => {
      for (const [key, data] of ctx?.snapshot ?? []) queryClient.setQueryData(key, data)
      if (queryClient.isMutating({ mutationKey: MENU_CHANGE.mutationKey }) <= 1) queryClient.invalidateQueries({ queryKey: ["menu"] })
      if (typeof window !== "undefined") window.dispatchEvent(new Event(MENU_CHANGE_FAILED_EVENT))
    },
  }
}

export function useGenerateMenu() {
  const queryClient = useQueryClient()

  return useMutation({
    /** `empty: true` skips the matcher and creates a row with all 7 days
     *  scaffolded per the user's mealTemplate but every slot empty
     *  (`dishes: []`). Powers "Vaciar semana" + "Empezar de cero". */
    // PRO-377: `onlyFavorites` («Rehacer la semana con mis favoritas»); the
    // answer says how many dishes are not favourites (`favoritesShort`).
    mutationFn: (params: { userId: string; weekStart: string; empty?: boolean; force?: boolean; weekPlan?: WeekPlan; onlyFavorites?: boolean }) =>
      api.post<Menu & { favoritesShort?: number }>("/menu/generate", params),
    onError: (err) => {
      // 409 MENU_NOT_EMPTY: the week has dishes we didn't know about (an
      // earlier GET failed). Re-read it instead of showing an empty week.
      if (err instanceof ApiError && err.code === "MENU_NOT_EMPTY") {
        queryClient.invalidateQueries({ queryKey: ["menu"] })
      }
    },
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
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; recipeId?: string }) =>
      v.recipeId ? pickRecipeIn(m, v.day, v.meal, recipeLook(queryClient, v.recipeId)) : null),
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      /** When provided, the server pins this recipe instead of running the matcher. */
      recipeId?: string
      /** «Añadir al menú» on a recipe (PRO-1024: only for the usage event). */
      from?: "receta"
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

      const body = params.recipeId ? { recipeId: params.recipeId, ...(params.from ? { from: params.from } : {}) } : undefined
      return api.put<Menu>(url, body)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
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
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; recipeId?: string }) =>
      v.recipeId ? addSlotIn(m, v.day, v.meal, recipeLook(queryClient, v.recipeId)) : null),
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      recipeId?: string
      /** «Añadir al menú» on a recipe (PRO-1024: only for the usage event). */
      from?: "receta"
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      const body = params.recipeId ? { recipeId: params.recipeId, ...(params.from ? { from: params.from } : {}) } : {}
      return api.post<Menu>(url, body)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
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
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string }) => removeSlotIn(m, v.day, v.meal)),
    mutationFn: async (params: { menuId: string; day: number; meal: string }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.delete<Menu>(url)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
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
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { fromDay: number; fromMeal: string; toDay: number; toMeal: string }) =>
      moveSlotIn(m, { day: v.fromDay, meal: v.fromMeal }, { day: v.toDay, meal: v.toMeal })),
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
    onSuccess: (data) => settleMenu(queryClient, data),
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
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; servings: number | null }) => patchSlotIn(m, v.day, v.meal, { servings: v.servings })),
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      servings: number | null
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.patch<Menu>(url, { servings: params.servings })
    },
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/** «Marcar como cocinada» / «Desmarcar» (PRO-185): the slot's `eaten`, the same Mimo sets. */
export function useSetSlotEaten() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; eaten: boolean }) => patchSlotIn(m, v.day, v.meal, { eaten: v.eaten })),
    mutationFn: async (params: { menuId: string; day: number; meal: string; eaten: boolean }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.patch<Menu>(url, { eaten: params.eaten })
    },
    onSuccess: (data) => settleMenu(queryClient, data),
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
    ...MENU_CHANGE,
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      pinnedType: string | null
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.patch<Menu>(url, { pinnedType: params.pinnedType })
    },
    onSuccess: (data) => settleMenu(queryClient, data),
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
    ...MENU_CHANGE,
    mutationFn: async (params: { menuId: string; recipeId: string }) => {
      return api.post<Menu>(`/menu/${params.menuId}/ban`, {
        recipeId: params.recipeId,
      })
    },
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

export function useUnbanRecipe() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    mutationFn: async (params: { menuId: string; recipeId: string }) => {
      return api.delete<Menu>(`/menu/${params.menuId}/ban/${params.recipeId}`)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
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
    ...MENU_CHANGE,
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
    onSuccess: (data) => settleMenu(queryClient, data),
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
    ...MENU_CHANGE,
    mutationFn: async (params: { menuId: string; day: number }) => {
      return api.post<Menu>(`/menu/${params.menuId}/day/${params.day}/skip`)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

export function useUnskipDay() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    mutationFn: async (params: { menuId: string; day: number }) => {
      return api.delete<Menu>(`/menu/${params.menuId}/day/${params.day}/skip`)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

export function useLockMeal() {
  const queryClient = useQueryClient()

  return useMutation({
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; locked: boolean }) => lockIn(m, v.day, v.meal, v.locked)),
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
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/**
 * Add a dish to a meal slot. Dishes can be either recipes or freeform notes.
 * The `payload` shape is a discriminated union:
 *   { kind: 'recipe'; recipeId: string; course?: Course; pinnedType?: string }
 *   { kind: 'note'; text: string }
 */
type AddDishPayload =
  | { kind: 'recipe'; recipeId: string; course?: string | null; pinnedType?: string | null; variant?: 'planned' | 'freezer' | 'fridge' }
  | { kind: 'note'; text: string }

export function useAddDish() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; payload: AddDishPayload }) => {
      if (v.payload.kind === "note") return addDishIn(m, v.day, v.meal, { kind: "note", text: v.payload.text })
      const look = recipeLook(queryClient, v.payload.recipeId)
      const variant = v.payload.variant === "freezer" || v.payload.variant === "fridge" ? v.payload.variant : undefined
      return addDishIn(m, v.day, v.meal, {
        kind: "recipe",
        recipeId: look.id,
        recipeName: look.name ?? undefined,
        imageUrl: look.imageUrl ?? null,
        ...(variant ? { variant } : {}),
      })
    }),
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      payload: AddDishPayload
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/dish`
      return api.post<Menu>(url, params.payload)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/**
 * PRO-223 · «Me lo llevo en táper»: the meal becomes the previous day's
 * dinner as a leftover, and that dinner is cooked with one more ration.
 * `on: false` undoes it (the meal is left empty).
 */
export function useSetTaper() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    mutationFn: async (params: { menuId: string; day: number; meal: string; on: boolean; count?: number }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/taper`
      return params.on ? api.post<Menu>(url, { count: params.count ?? 1 }) : api.delete<Menu>(url)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/**
 * Remove a dish from a meal slot by position (0-indexed).
 */
export function useRemoveDish() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; position: number }) => removeDishIn(m, v.day, v.meal, v.position)),
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      position: number
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/dish/${params.position}`
      return api.delete<Menu>(url)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/**
 * Update a dish's metadata (note text, pinnedType, newPosition for reordering, course).
 * Position is 0-indexed; newPosition moves the dish within the slot (no swap).
 */
export function usePatchDish() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; position: number; patch: { text?: string; newPosition?: number; variant?: 'planned' | 'freezer' | 'cooked' } }) =>
      patchDishIn(m, v.day, v.meal, v.position, v.patch)),
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      position: number
      patch: { text?: string; pinnedType?: string | null; newPosition?: number; course?: string | null; variant?: 'planned' | 'freezer' | 'cooked' }
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/dish/${params.position}`
      return api.patch<Menu>(url, params.patch)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/**
 * Regenerate a recipe dish at a given position via the matcher (Aleatorio).
 * Respects the slot's pinnedType and menu's bannedRecipeIds.
 */
export function useRegenerateDish() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    mutationFn: async (params: {
      menuId: string
      day: number
      meal: string
      position: number
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/dish/${params.position}/regenerate`
      return api.post<Menu>(url)
    },
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/**
 * Append a random recipe dish picked by the matcher. Used by Aleatorio in
 * the add-dish bottom sheet so the user gets a sensible recipe without typing.
 */
export function useAddRandomDish() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    mutationFn: async (params: { menuId: string; day: number; meal: string }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/dish/random`
      return api.post<Menu>(url)
    },
    onSuccess: () => settleMenu(queryClient, null),
  })
}
