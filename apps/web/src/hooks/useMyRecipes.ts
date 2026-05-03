/**
 * Hooks for the "Mis recetas" tab inside /profile.
 *
 * Reads from `/user/:id/recipes-curator/gaps` — a per-user clone of the
 * admin recipe-gaps endpoint that surfaces the same status pills (sin
 * nutrición, ingredientes auto-añadidos, etc.) so the author can clean
 * up their own catalog.
 *
 * Delete reuses `DELETE /recipes/:id`, which already enforces
 * "author only" on the API.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export interface MyRecipeRow {
  id: string
  name: string
  imageUrl: string | null
  servings: number
  kcal: number | null
  allergens: string[]
  totalTime: number | null
  updatedAt: string | null
  statusPills: string[]
}

export interface MyRecipesResponse {
  recipes: MyRecipeRow[]
  counts: {
    total: number
    sinNutricion: number
    ingredientesPendientesRevision: number
  }
}

export function useMyRecipes() {
  const { user } = useAuth()
  return useQuery<MyRecipesResponse>({
    queryKey: ["my-recipes", user?.id],
    queryFn: () =>
      api.get<MyRecipesResponse>(
        `/user/${user!.id}/recipes-curator/gaps`,
      ),
    enabled: !!user?.id,
    staleTime: 15 * 1000,
  })
}

export function useDeleteMyRecipe() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/recipes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-recipes"] })
      qc.invalidateQueries({ queryKey: ["recipes"] })
    },
  })
}
