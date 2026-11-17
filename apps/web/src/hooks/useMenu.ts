import { useQuery, useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query"
import { api, ApiError } from "@/lib/api"
import { enqueue } from "@/lib/pwa/offlineQueue"
import { dishKey, slotKey, type MenuFit, type WeekPlan, type WeekTypeOption } from "@ona/shared"
import { NO_RECIPE_OF_TYPE, regenerateMealBody, type WeekTypeApplied } from "@/lib/mealSheet"
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
  replaceWithNoteIn,
  type OptimisticMenu,
  type RecipeLook,
} from "@/lib/menuOptimistic"

interface MealSlot {
  recipeId: string
  recipeName?: string
  /** Per-slot diner override (this week only); null/undefined = household default. */
  servings?: number | null
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
  const queryClient = useQueryClient()
  return useQuery<Menu | null>({
    queryKey: ["menu", userId, weekStart],
    // Not while changes are on their way (2026-11-10): the server's week
    // doesn't have them yet, and painting it would undo them on screen.
    refetchOnWindowFocus: () => changesPending(queryClient) === 0,
    queryFn: async () => {
      try {
        const fresh = await api.get<Menu>(`/menu/${userId}/${weekStart}`)
        // A read that lands while changes are queued (Mimo's invalidateQueries(),
        // another tab…) keeps the week on screen; the queue re-reads it when it
        // empties (`settleMenu`).
        const shown = queryClient.getQueryData<Menu | null>(["menu", userId, weekStart])
        if (changesPending(queryClient) > 0 && shown) return shown
        return fresh
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

/** A change that hasn't answered after this long fails (and goes back): a hung request held the whole queue. */
export const MENU_CHANGE_TIMEOUT_MS = 20_000
const changeOpts = () => ({ signal: AbortSignal.timeout(MENU_CHANGE_TIMEOUT_MS) })

/** Is a change of the menu on its way (drawn, not answered yet)? */
const changesPending = (queryClient: QueryClient) => queryClient.isMutating({ mutationKey: MENU_CHANGE.mutationKey })

/**
 * After a change: the server's week (when the route returns it) and a fresh
 * read — but only once the queue is empty, or the answer to the first change
 * would paint over the ones still on their way (they're on screen already).
 */
function settleMenu(queryClient: QueryClient, data: unknown) {
  // This change still counts as pending while its onSuccess runs.
  if (changesPending(queryClient) > 1) return
  const m = data as { userId?: string; weekStart?: string } | null | undefined
  if (m?.userId && m?.weekStart) queryClient.setQueryData(["menu", m.userId, m.weekStart], data)
  queryClient.invalidateQueries({ queryKey: ["menu"] })
  queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
}

/** Fired when a change shown at once had to be undone: the page says so (`detail.undone`: how many). */
export const MENU_CHANGE_FAILED_EVENT = "ona:menu-change-failed"

/**
 * What each change saw when it was made: `epoch` (bumped when one fails — the
 * ones queued behind it are dropped, never sent) and `expect` (`dishKey` /
 * `slotKey` of what a change by position touches; the route answers 409 if
 * the week no longer has it there). Keyed by the mutation's variables.
 */
let changeEpoch = 0
const changeMeta = new WeakMap<object, { epoch: number; expect: Record<string, string> }>()

/** A change dropped because one before it failed (the week already went back). */
class DiscardedChange extends Error {
  constructor() {
    super("Descartado: falló un cambio anterior")
    this.name = "DiscardedChange"
  }
}

/** The change's request, unless a change before it failed; with what it expects to find. */
function queued<V extends object, R>(fn: (v: V, expect: Record<string, string>) => Promise<R>) {
  return async (v: V) => {
    const meta = changeMeta.get(v)
    if (meta && meta.epoch < changeEpoch) throw new DiscardedChange()
    return fn(v, meta?.expect ?? {})
  }
}

/** `?expect=` for the DELETE routes. */
const expectQuery = (expect: Record<string, string>) => (expect.expect ? `?expect=${encodeURIComponent(expect.expect)}` : "")

/** Name, photo and course of a recipe the page already has (the picker's list, `["recipes", …]`). */
function recipeLook(queryClient: QueryClient, id: string): RecipeLook {
  for (const [, data] of queryClient.getQueriesData<unknown>({ queryKey: ["recipes"] })) {
    if (!Array.isArray(data)) continue
    const r = data.find((x) => x && typeof x === "object" && (x as { id?: string }).id === id) as
      | { id: string; name?: string; imageUrl?: string | null; course?: RecipeLook["course"] }
      | undefined
    if (r) return { id, name: r.name, imageUrl: r.imageUrl ?? null, course: r.course ?? null }
  }
  return { id }
}

/**
 * The change on screen at once (2026-11-10, Miguel: «tardan mucho en
 * mostrarse»): before the request goes out, the cached week gets `apply`
 * (lib/menuOptimistic.ts); `expect` notes what a change by position touches.
 * If the API fails (or 20 s go by), the week goes back to how it was before
 * that change, the changes queued behind it are dropped — they were drawn on
 * top of it — and the page says how many were undone. A refetch in flight is
 * cancelled so it can't paint the old week over it. `apply` returning null
 * leaves the week alone (e.g. «al azar», whose dish only the server knows).
 */
function optimistic<V>(
  queryClient: QueryClient,
  apply: (menu: OptimisticMenu, v: V) => OptimisticMenu | null,
  expect?: (menu: OptimisticMenu, v: V) => Record<string, string>,
) {
  return {
    onMutate: async (v: V & { menuId: string }) => {
      await queryClient.cancelQueries({ queryKey: ["menu"] })
      const snapshot = queryClient.getQueriesData<unknown>({ queryKey: ["menu"] })
      const seen = snapshot
        .map(([, d]) => d as OptimisticMenu | null | undefined)
        .find((m) => m && typeof m === "object" && m.id === v.menuId && Array.isArray(m.days))
      changeMeta.set(v, { epoch: changeEpoch, expect: seen && expect ? expect(seen, v) : {} })
      queryClient.setQueriesData<unknown>({ queryKey: ["menu"] }, (old: unknown) => {
        const m = old as OptimisticMenu | null | undefined
        if (!m || typeof m !== "object" || m.id !== v.menuId || !Array.isArray(m.days)) return old
        return apply(m, v) ?? old
      })
      return { snapshot }
    },
    onError: (err: unknown, v: V & { menuId: string }, ctx: { snapshot: [QueryKey, unknown][] } | undefined) => {
      if (err instanceof DiscardedChange) {
        // The failure ahead of it already put the week back and said so.
        if (changesPending(queryClient) <= 1) queryClient.invalidateQueries({ queryKey: ["menu"] })
        return
      }
      const behind = queryClient
        .getMutationCache()
        .findAll({ mutationKey: MENU_CHANGE.mutationKey, status: "pending" })
        .filter((m) => m.state.variables !== v).length
      changeEpoch++
      for (const [key, data] of ctx?.snapshot ?? []) queryClient.setQueryData(key, data)
      if (behind === 0) queryClient.invalidateQueries({ queryKey: ["menu"] })
      // «Que elija Mimoia» with a type nothing fits: the picker says why, and nothing was drawn.
      const saidInPlace = err instanceof ApiError && err.code === NO_RECIPE_OF_TYPE && behind === 0
      if (typeof window !== "undefined" && !saidInPlace) {
        window.dispatchEvent(new CustomEvent(MENU_CHANGE_FAILED_EVENT, { detail: { undone: 1 + behind } }))
      }
    },
  }
}

/** For the changes whose result only the server knows: no drawing, but the queue's rules. */
const queueOnly = <V,>(queryClient: QueryClient, expect?: (menu: OptimisticMenu, v: V) => Record<string, string>) =>
  optimistic<V>(queryClient, () => null, expect)

export function useGenerateMenu() {
  const queryClient = useQueryClient()

  return useMutation({
    /** `empty: true` skips the matcher and creates a row with all 7 days
     *  scaffolded per the household's semana tipo but every slot empty
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
    // A recipe chosen by hand stays when the week is redone (PRO-1175): the server locks it.
    ...optimistic(queryClient, (m, v: { day: number; meal: string; recipeId?: string }) =>
      v.recipeId ? lockIn(pickRecipeIn(m, v.day, v.meal, recipeLook(queryClient, v.recipeId)), v.day, v.meal, true) : null),
    mutationFn: queued(async (params: {
      menuId: string
      day: number
      meal: string
      /** When provided, the server pins this recipe instead of running the matcher. */
      recipeId?: string
      /** PRO-1175: «Que elija Mimoia» with a type chip of the picker (`DISH_TYPES` key). */
      dishType?: string | null
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

      return api.put<Menu>(url, regenerateMealBody(params), changeOpts())
    }),
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
      v.recipeId ? lockIn(addSlotIn(m, v.day, v.meal, recipeLook(queryClient, v.recipeId)), v.day, v.meal, true) : null),
    mutationFn: queued(async (params: {
      menuId: string
      day: number
      meal: string
      recipeId?: string
      /** «Añadir al menú» on a recipe (PRO-1024: only for the usage event). */
      from?: "receta"
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      const body = params.recipeId ? { recipeId: params.recipeId, ...(params.from ? { from: params.from } : {}) } : {}
      return api.post<Menu>(url, body, changeOpts())
    }),
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
    ...optimistic(
      queryClient,
      (m, v: { day: number; meal: string }) => removeSlotIn(m, v.day, v.meal),
      (m, v) => ({ expect: slotKey(m.days[v.day]?.[v.meal]) }),
    ),
    mutationFn: queued(async (params: { menuId: string; day: number; meal: string }, expect) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.delete<Menu>(url + expectQuery(expect), undefined, changeOpts())
    }),
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
    ...optimistic(
      queryClient,
      (m, v: { fromDay: number; fromMeal: string; toDay: number; toMeal: string }) =>
        moveSlotIn(m, { day: v.fromDay, meal: v.fromMeal }, { day: v.toDay, meal: v.toMeal }),
      (m, v) => ({ expectFrom: slotKey(m.days[v.fromDay]?.[v.fromMeal]), expectTo: slotKey(m.days[v.toDay]?.[v.toMeal]) }),
    ),
    mutationFn: queued(async (params: {
      menuId: string
      fromDay: number
      fromMeal: string
      toDay: number
      toMeal: string
    }, expect) => {
      return api.post<Menu>(
        `/menu/${params.menuId}/move-slot`,
        { fromDay: params.fromDay, fromMeal: params.fromMeal, toDay: params.toDay, toMeal: params.toMeal, ...expect },
        changeOpts(),
      )
    }),
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
    mutationFn: queued(async (params: {
      menuId: string
      day: number
      meal: string
      servings: number | null
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.patch<Menu>(url, { servings: params.servings }, changeOpts())
    }),
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/** «Marcar como cocinada» / «Desmarcar» (PRO-185): the slot's `eaten`, the same Mimo sets. */
export function useSetSlotEaten() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; eaten: boolean }) => patchSlotIn(m, v.day, v.meal, { eaten: v.eaten })),
    mutationFn: queued(async (params: { menuId: string; day: number; meal: string; eaten: boolean }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.patch<Menu>(url, { eaten: params.eaten }, changeOpts())
    }),
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
    ...queueOnly(queryClient),
    mutationFn: queued(async (params: { menuId: string; recipeId: string }) => {
      return api.post<Menu>(`/menu/${params.menuId}/ban`, {
        recipeId: params.recipeId,
      }, changeOpts())
    }),
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

export function useUnbanRecipe() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...queueOnly(queryClient),
    mutationFn: queued(async (params: { menuId: string; recipeId: string }) => {
      return api.delete<Menu>(`/menu/${params.menuId}/ban/${params.recipeId}`, undefined, changeOpts())
    }),
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
    ...queueOnly(queryClient),
    mutationFn: queued(async (params: {
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
      }, changeOpts())
    }),
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
    ...queueOnly(queryClient),
    mutationFn: queued(async (params: { menuId: string; day: number }) => {
      return api.post<Menu>(`/menu/${params.menuId}/day/${params.day}/skip`, undefined, changeOpts())
    }),
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

export function useUnskipDay() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...queueOnly(queryClient),
    mutationFn: queued(async (params: { menuId: string; day: number }) => {
      return api.delete<Menu>(`/menu/${params.menuId}/day/${params.day}/skip`, undefined, changeOpts())
    }),
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

export function useLockMeal() {
  const queryClient = useQueryClient()

  return useMutation({
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; locked: boolean }) => lockIn(m, v.day, v.meal, v.locked)),
    mutationFn: queued(async (params: { menuId: string; day: number; meal: string; locked: boolean }) => {
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

      return api.put<Menu>(url, body, changeOpts())
    }),
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/**
 * Add a dish to a meal slot. Dishes can be either recipes or freeform notes.
 * The `payload` shape is a discriminated union:
 *   { kind: 'recipe'; recipeId: string; course?: Course }
 *   { kind: 'note'; text: string }
 */
type AddDishPayload =
  | { kind: 'recipe'; recipeId: string; course?: string | null; variant?: 'planned' | 'freezer' | 'fridge' }
  | { kind: 'note'; text: string }

export function useAddDish() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...optimistic(queryClient, (m, v: { day: number; meal: string; payload: AddDishPayload }) => {
      // A dish added by hand stays when the week is redone (PRO-1175): the server locks the meal.
      const kept = lockIn(m, v.day, v.meal, true)
      if (v.payload.kind === "note") return addDishIn(kept, v.day, v.meal, { kind: "note", text: v.payload.text })
      const look = recipeLook(queryClient, v.payload.recipeId)
      const variant = v.payload.variant === "freezer" || v.payload.variant === "fridge" ? v.payload.variant : undefined
      return addDishIn(kept, v.day, v.meal, {
        kind: "recipe",
        recipeId: look.id,
        recipeName: look.name ?? undefined,
        imageUrl: look.imageUrl ?? null,
        ...(variant ? { variant } : {}),
      })
    }),
    mutationFn: queued(async (params: {
      menuId: string
      day: number
      meal: string
      payload: AddDishPayload
    }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/dish`
      return api.post<Menu>(url, params.payload, changeOpts())
    }),
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/**
 * PRO-1186 · «Guardar en mi semana tipo»: that day and meal of the household's
 * week type take this option every week, and the meal on screen follows it
 * unless it is locked, eaten or a táper. Only the server knows the dish it
 * draws, so nothing is drawn before; the answer says what it did
 * (`weekTypeApplied`). Re-reads «Tu semana tipo».
 */
export function useSaveMealToWeekType() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...queueOnly(queryClient),
    mutationFn: queued(async (params: { menuId: string; day: number; meal: string; option: WeekTypeOption }) =>
      api.post<Menu & { weekTypeApplied: WeekTypeApplied }>(`/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/week-type`, { option: params.option }, changeOpts()),
    ),
    onSuccess: (data) => {
      settleMenu(queryClient, data)
      queryClient.invalidateQueries({ queryKey: ["week-type"] })
    },
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
    ...queueOnly(queryClient),
    mutationFn: queued(async (params: { menuId: string; day: number; meal: string; on: boolean; count?: number }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/taper`
      return params.on ? api.post<Menu>(url, { count: params.count ?? 1 }, changeOpts()) : api.delete<Menu>(url, undefined, changeOpts())
    }),
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
    ...optimistic(
      queryClient,
      (m, v: { day: number; meal: string; position: number }) => removeDishIn(m, v.day, v.meal, v.position),
      (m, v) => ({ expect: dishKey(m.days[v.day]?.[v.meal]?.dishes?.[v.position]) }),
    ),
    mutationFn: queued(async (params: {
      menuId: string
      day: number
      meal: string
      position: number
    }, expect) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/dish/${params.position}`
      return api.delete<Menu>(url + expectQuery(expect), undefined, changeOpts())
    }),
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/**
 * Update a dish's metadata (note text, newPosition for reordering, course).
 * Position is 0-indexed; newPosition moves the dish within the slot (no swap).
 */
export function usePatchDish() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...optimistic(
      queryClient,
      (m, v: { day: number; meal: string; position: number; patch: { text?: string; newPosition?: number; variant?: 'planned' | 'freezer' | 'cooked' } }) =>
        patchDishIn(m, v.day, v.meal, v.position, v.patch),
      (m, v) => ({ expect: dishKey(m.days[v.day]?.[v.meal]?.dishes?.[v.position]) }),
    ),
    mutationFn: queued(async (params: {
      menuId: string
      day: number
      meal: string
      position: number
      patch: { text?: string; newPosition?: number; course?: string | null; variant?: 'planned' | 'freezer' | 'cooked' }
    }, expect) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/dish/${params.position}`
      return api.patch<Menu>(url, { ...params.patch, ...expect }, changeOpts())
    }),
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}

/**
 * Regenerate a recipe dish at a given position via the matcher (Aleatorio).
 * Respects the dish type the household's «semana tipo» asks for there and the menu's bannedRecipeIds.
 */
export function useRegenerateDish() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...queueOnly(queryClient, (m, v: { day: number; meal: string; position: number }) => ({
      expect: dishKey(m.days[v.day]?.[v.meal]?.dishes?.[v.position]),
    })),
    mutationFn: queued(async (params: {
      menuId: string
      day: number
      meal: string
      position: number
    }, expect) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/dish/${params.position}/regenerate`
      return api.post<Menu>(url, expect, changeOpts())
    }),
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
    ...queueOnly(queryClient),
    mutationFn: queued(async (params: { menuId: string; day: number; meal: string }) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}/dish/random`
      return api.post<Menu>(url, undefined, changeOpts())
    }),
    onSuccess: () => settleMenu(queryClient, null),
  })
}

/**
 * «Usar "<lo escrito>" como plato» (PRO-74): the meal's dishes become the
 * text, «Solo hoy» kept, in one request (`PUT …/meal/:meal { note }`,
 * 2026-11-10; it was DELETE meal + POST dish + PATCH servings, and a failure
 * in the middle left the meal deleted).
 */
export function useReplaceWithNote() {
  const queryClient = useQueryClient()
  return useMutation({
    ...MENU_CHANGE,
    ...optimistic(
      queryClient,
      (m, v: { day: number; meal: string; text: string }) => lockIn(replaceWithNoteIn(m, v.day, v.meal, v.text), v.day, v.meal, true),
      (m, v) => ({ expect: slotKey(m.days[v.day]?.[v.meal]) }),
    ),
    mutationFn: queued(async (params: { menuId: string; day: number; meal: string; text: string }, expect) => {
      const url = `/menu/${params.menuId}/day/${params.day}/meal/${params.meal}`
      return api.put<Menu>(url, { note: params.text, ...expect }, changeOpts())
    }),
    onSuccess: (data) => settleMenu(queryClient, data),
  })
}
