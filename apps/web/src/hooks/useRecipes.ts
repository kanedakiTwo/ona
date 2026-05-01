import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { ExtractedRecipe } from "@ona/shared"

interface Recipe {
  id: string
  name: string
  authorId: string | null
  description: string
  ingredients: string[]
  steps: string[]
  tags: string[]
  is_favorite?: boolean
}

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

export function useCreateRecipe() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (recipe: Omit<Recipe, "id" | "authorId">) =>
      api.post<Recipe>("/recipes", recipe),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] })
    },
  })
}

export function useToggleFavorite() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { userId: string; recipeId: string }) =>
      api.post(`/user/${params.userId}/recipes/${params.recipeId}/favorite`),
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
