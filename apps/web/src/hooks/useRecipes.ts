import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { enqueue } from "@/lib/pwa/offlineQueue"
import type { ExtractedRecipe, Recipe } from "@ona/shared"

interface RecipeFilters {
  search?: string
  meal?: string
  season?: string
  perPage?: number
}

function buildQueryString(filters?: RecipeFilters): string {
  if (!filters) return ""
  const params = new URLSearchParams()
  if (filters.search) params.set("search", filters.search)
  if (filters.meal) params.set("meal", filters.meal)
  if (filters.season) params.set("season", filters.season)
  if (filters.perPage) params.set("perPage", String(filters.perPage))
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export function useRecipes(filters?: RecipeFilters) {
  return useQuery<Recipe[]>({
    queryKey: ["recipes", filters],
    queryFn: () => api.get(`/recipes${buildQueryString(filters)}`),
  })
}

export function useRecipe(id: string | undefined) {
  return useQuery<Recipe>({
    queryKey: ["recipe", id],
    queryFn: () => api.get(`/recipes/${id}`),
    enabled: !!id,
  })
}

// Legacy create-recipe payload sent by the new-recipe form. This intentionally
// does not align 1:1 with the shared Recipe type (the form posts a flat
// description + string[] ingredients shape). Kept loose here to preserve
// existing runtime behavior; align with createRecipeSchema in a follow-up.
interface CreateRecipeInput {
  name: string
  description?: string
  ingredients: string[]
  steps: string[]
  tags: string[]
  is_favorite?: boolean
}

export function useCreateRecipe() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (recipe: CreateRecipeInput) =>
      api.post<Recipe>("/recipes", recipe),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
    },
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
