import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { api } from "@/lib/api"
import { enqueue } from "@/lib/pwa/offlineQueue"
import { createRecipeSchema } from "@ona/shared"
import type { ExtractedRecipe, Ingredient, Recipe } from "@ona/shared"

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>

import { buildQueryString, type RecipeFilters } from "@/lib/recipeQuery"

export function useRecipes(filters?: RecipeFilters) {
  return useQuery<Recipe[]>({
    queryKey: ["recipes", filters],
    queryFn: () => api.get(`/recipes${buildQueryString(filters)}`),
  })
}

/** A card from «Con lo que tengo»: which chosen ingredients it uses and what's missing (basics excluded). */
export type WithWhatIHaveRecipe = Recipe & { uses: string[]; missing: string[] }

/**
 * «Con lo que tengo» (PRO-31): GET /recipes/with-what-i-have for 1–3
 * catalogue ingredient ids. Ranked by the server (most chosen ingredients
 * used first). Disabled with no ingredients.
 */
export function useRecipesWithWhatIHave(ingredientIds: string[]) {
  const qs = ingredientIds.map((id) => `ingredient=${encodeURIComponent(id)}`).join("&")
  return useQuery<WithWhatIHaveRecipe[]>({
    queryKey: ["recipes", "with-what-i-have", ingredientIds],
    queryFn: () => api.get(`/recipes/with-what-i-have?${qs}`),
    enabled: ingredientIds.length > 0,
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
    mutationFn: (recipe: CreateRecipeInput & { force?: boolean; ownPhoto?: boolean }) => {
      const { force, ownPhoto, ...payload } = recipe
      // `ownPhoto`: the form uploads the user's photo right after — the API
      // then skips the AI photo (PRO-145).
      const params = new URLSearchParams()
      if (force) params.set("force", "1")
      if (ownPhoto) params.set("ownPhoto", "1")
      const qs = params.toString()
      const url = qs ? `/recipes?${qs}` : "/recipes"
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
    // Awaited so the recipe is refetched before the caller navigates back to
    // the detail: its "Para hacer la compra" notice is recomputed on every
    // read and must reflect what was just saved (PRO-90).
    onSuccess: (data) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recipes"] }),
        queryClient.invalidateQueries({ queryKey: ["recipe", data.id] }),
      ]),
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
  /** Flip `is_favorite` for this recipe in every cached list and detail (the heart answers at once). */
  const flip = (recipeId: string) => {
    queryClient.setQueriesData<Recipe[] | undefined>({ queryKey: ["recipes"] }, (old) =>
      Array.isArray(old) ? old.map((r) => (r.id === recipeId ? { ...r, is_favorite: !r.is_favorite } : r)) : old,
    )
    queryClient.setQueriesData<Recipe | undefined>({ queryKey: ["recipe", recipeId] }, (old) =>
      old && !Array.isArray(old) ? { ...old, is_favorite: !old.is_favorite } : old,
    )
  }

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
        // (The heart already flipped in onMutate.)
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("ona-queue-changed"))
        }
        return { offline: true }
      }

      return api.post(url)
    },
    // Optimistic, online or offline: the heart flips at once; a failed call flips it back.
    onMutate: (params) => flip(params.recipeId),
    onError: (_err, params) => flip(params.recipeId),
    onSuccess: (out) => {
      if (out && typeof out === "object" && "offline" in out) return
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
      queryClient.invalidateQueries({ queryKey: ["recipe"] })
      queryClient.invalidateQueries({ queryKey: ["user-recipes"] })
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
   * `authorId = null` and tagged `compartida` so it lands in the Mimoia
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
 * Regenerate the hero photo of an existing recipe via the house image provider (AiKit gpt-image-2, OpenAI as reserve).
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

/** Hero photos bigger than this are rejected by the API (413). */
export const OWN_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/**
 * «Subir mi foto» (PRO-145): the user's own photo becomes the recipe's main
 * photo. Authors on their own recipes, admins on any. The server crops it to
 * 4:3 (≤ 1200 px JPEG) and it never counts against the AI image quota.
 */
export async function uploadRecipeImage(recipeId: string, file: File): Promise<{ imageUrl: string }> {
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
}

export function useUploadRecipeImage(recipeId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation<{ imageUrl: string }, Error, File>({
    mutationFn: async (file: File) => {
      if (!recipeId) throw new Error("Falta el id de la receta")
      return uploadRecipeImage(recipeId, file)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] })
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
    },
  })
}
