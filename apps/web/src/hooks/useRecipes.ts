import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { api, apiPublic } from "@/lib/api"
import { enqueue } from "@/lib/pwa/offlineQueue"
import { createRecipeSchema } from "@ona/shared"
import type { ExtractedRecipe, Ingredient, Recipe } from "@ona/shared"

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>

interface RecipeFilters {
  search?: string
  meal?: string
  season?: string
  perPage?: number
  /** PR 8B-2: household-scoped custom-tag filter (AND across entries). */
  customTags?: string[]
}

function buildQueryString(filters?: RecipeFilters): string {
  if (!filters) return ""
  const params = new URLSearchParams()
  if (filters.search) params.set("search", filters.search)
  if (filters.meal) params.set("meal", filters.meal)
  if (filters.season) params.set("season", filters.season)
  if (filters.perPage) params.set("perPage", String(filters.perPage))
  for (const tag of filters.customTags ?? []) {
    params.append("customTag", tag)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export function useRecipes(filters?: RecipeFilters) {
  return useQuery<Recipe[]>({
    queryKey: ["recipes", filters],
    queryFn: () => api.get(`/recipes${buildQueryString(filters)}`),
  })
}

/**
 * Same as `useRecipes` but hits the API anonymously — even if a token is
 * present in localStorage. Used by the public `/recipes-ona` catalogue so
 * a logged-in browser still sees only system recipes.
 */
export function usePublicRecipes(filters?: RecipeFilters) {
  return useQuery<Recipe[]>({
    queryKey: ["recipes-public", filters],
    queryFn: () => apiPublic.get(`/recipes${buildQueryString(filters)}`),
  })
}

export function usePublicRecipe(id: string | undefined) {
  return useQuery<Recipe>({
    queryKey: ["recipe-public", id],
    queryFn: () => apiPublic.get(`/recipes/${id}`),
    enabled: !!id,
  })
}

/**
 * Fetch a single recipe. When `servings` is supplied (and positive), the
 * API scales the response per Task 11; the cache key includes `servings`
 * so changing the scaler triggers a refetch.
 */
export function useRecipe(id: string | undefined, servings?: number) {
  const hasServings = servings != null && Number.isFinite(servings) && servings > 0
  const qs = hasServings ? `?servings=${servings}` : ""
  return useQuery<Recipe>({
    queryKey: ["recipe", id, hasServings ? servings : null],
    queryFn: () => api.get(`/recipes/${id}${qs}`),
    enabled: !!id,
  })
}

export interface CreateRecipeResponse extends Recipe {
  /**
   * Soft-lint warnings surfaced by the server when `force: true` was sent.
   * Empty on a strict-validated create. The detail page can render these as
   * advisory notes.
   */
  warnings?: Array<{ code: string; message: string; path?: string }>
}

export function useCreateRecipe() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (recipe: CreateRecipeInput & { force?: boolean }) => {
      const { force, ...payload } = recipe
      const url = force ? "/recipes?force=1" : "/recipes"
      return api.post<CreateRecipeResponse>(url, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
    },
  })
}

/**
 * Copy a recipe (system or another user's) into the caller's catalog.
 * Server clones the row + ingredients + steps with `authorId = me`, remaps
 * `step.ingredientRefs`, and tags the copy `internalTags: ['copied-from-catalog']`.
 * Returns the new recipe; caller typically navigates to /recipes/<newId>.
 */
export function useCopyRecipe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sourceId: string) =>
      api.post<Recipe>(`/recipes/${sourceId}/copy`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
    },
  })
}

/**
 * Update an existing recipe (author-only on the server). PUT requires a
 * COMPLETE payload — name, servings, meals, ingredients, steps — so the
 * caller must always send the full edited recipe.
 */
export function useUpdateRecipe(id: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (recipe: CreateRecipeInput & { force?: boolean }) => {
      if (!id) throw new Error("recipe id is required to update")
      const { force, ...payload } = recipe
      // Mirror the create flow: `?force=1` downgrades lint errors to soft
      // warnings on the server so the user can save imperfect recipes.
      const url = force ? `/recipes/${id}?force=1` : `/recipes/${id}`
      return api.put<Recipe>(url, payload)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
      queryClient.invalidateQueries({ queryKey: ["recipe", data.id] })
    },
  })
}

// All ingredients from the global library. Used by the recipe form's
// autocomplete picker so users can bind free-text names to the ingredient
// UUIDs the API expects.
export function useIngredients() {
  return useQuery<Ingredient[]>({
    queryKey: ["ingredients"],
    // perPage=300 covers the seeded library (~250 entries) in one call.
    queryFn: () => api.get<Ingredient[]>("/ingredients?perPage=300"),
    staleTime: 10 * 60 * 1000,
  })
}

export function useToggleFavorite() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { userId: string; recipeId: string }) => {
      const url = `/user/${params.userId}/recipes/${params.recipeId}/favorite`

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueue({
          id: crypto.randomUUID(),
          url,
          method: "POST",
          timestamp: Date.now(),
          resourceId: params.recipeId,
        })
        // Optimistic update: flip is_favorite for this recipe in any cached list/detail
        queryClient.setQueriesData<Recipe[] | undefined>({ queryKey: ["recipes"] }, (old) => {
          if (!old) return old
          return old.map((r) =>
            r.id === params.recipeId ? { ...r, is_favorite: !r.is_favorite } : r
          )
        })
        queryClient.setQueriesData<Recipe | undefined>({ queryKey: ["recipe", params.recipeId] }, (old) => {
          if (!old) return old
          return { ...old, is_favorite: !old.is_favorite }
        })
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("ona-queue-changed"))
        }
        return { offline: true }
      }

      return api.post(url)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
      queryClient.invalidateQueries({ queryKey: ["recipe"] })
    },
  })
}

export function useExtractRecipeFromImage() {
  return useMutation({
    mutationFn: async (imageFile: File) => {
      const formData = new FormData()
      formData.append("image", imageFile)
      return api.upload<ExtractedRecipe>(
        "/recipes/extract-from-image",
        formData
      )
    },
  })
}

/**
 * Result returned by `POST /recipes/extract-from-url`. The endpoint persists
 * the recipe directly (mirroring extract-from-image), so we get the saved
 * detail back together with the lint/match warnings.
 */
export interface ExtractRecipeFromUrlResponse {
  recipe: { id: string; name: string }
  warnings: string[]
}

export interface ExtractRecipeFromUrlInput {
  url: string
  /** Admin-only. When true, the imported recipe is persisted with
   * `authorId = null` and tagged `compartida` so it lands in the ONA
   * catalogue. Non-admins get 403 server-side. */
  asSystem?: boolean
}

export function useExtractRecipeFromUrl() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ExtractRecipeFromUrlInput | string) => {
      const body = typeof input === "string" ? { url: input } : input
      return api.post<ExtractRecipeFromUrlResponse>(
        "/recipes/extract-from-url",
        body
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
    },
  })
}

export interface RegenerateImageResponse {
  imageUrl: string
  quota: { used: number; limit: number; monthKey: string }
}

/**
 * Regenerate the hero photo of an existing recipe via AiKit Imagen-fal.
 * Author-only; system recipes return 403. The user has a monthly quota
 * (default 20) — when exhausted the API returns 429 and the mutation
 * rejects; the caller can read the cap from `useUser().imageGenQuota`.
 *
 * On success, both the recipe (so the hero image refreshes) and the
 * `["user", userId]` query (so the quota counter updates) are invalidated.
 */
export function useRegenerateRecipeImage(recipeId: string | undefined, userId?: string) {
  const queryClient = useQueryClient()
  return useMutation<RegenerateImageResponse, Error>({
    mutationFn: async () => {
      if (!recipeId) throw new Error("Falta el id de la receta")
      return api.post<RegenerateImageResponse>(`/recipes/${recipeId}/regenerate-image`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] })
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
      if (userId) queryClient.invalidateQueries({ queryKey: ["user", userId] })
    },
  })
}

/**
 * Upload a user-supplied hero photo. Available to authors on their own
 * recipes and to admins on any recipe (including the curated ONA catalog).
 * Does not touch the AI quota. The server resizes to 1200 px wide JPEG.
 */
export function useUploadRecipeImage(recipeId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation<{ imageUrl: string }, Error, File>({
    mutationFn: async (file: File) => {
      if (!recipeId) throw new Error("Falta el id de la receta")
      const form = new FormData()
      form.append("image", file)
      // The shared `api` helper json-stringifies the body — bypass it for
      // multipart and let the browser set the boundary header.
      const token = typeof window !== "undefined" ? localStorage.getItem("ona_token") : null
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/recipes/${recipeId}/upload-image`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        },
      )
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try {
          const body = (await res.json()) as { error?: string }
          if (body.error) msg = body.error
        } catch {
          // ignore — non-JSON body
        }
        throw new Error(msg)
      }
      return (await res.json()) as { imageUrl: string }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] })
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
    },
  })
}
