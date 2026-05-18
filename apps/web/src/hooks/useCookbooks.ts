/**
 * Cookbook hooks (PR 8A). Household-shared named recipe collections.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface Cookbook {
  id: string
  householdId: string
  name: string
  description: string | null
  emoji: string | null
  recipeCount: number
  createdAt: string
  updatedAt: string
}

export interface CookbookRecipeRow {
  id: string
  name: string
  imageUrl: string | null
  addedAt: string
}

export interface CookbookDetail extends Cookbook {
  recipes: CookbookRecipeRow[]
}

export interface RecipeCookbookHit {
  cookbookId: string
  name: string
  emoji: string | null
}

export function useCookbooks() {
  return useQuery<Cookbook[]>({
    queryKey: ["cookbooks"],
    queryFn: () => api.get<Cookbook[]>("/cookbooks"),
    staleTime: 30_000,
  })
}

export function useCookbook(id: string | undefined) {
  return useQuery<CookbookDetail>({
    queryKey: ["cookbooks", id],
    queryFn: () => api.get<CookbookDetail>(`/cookbooks/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useCookbooksForRecipe(recipeId: string | undefined) {
  return useQuery<RecipeCookbookHit[]>({
    queryKey: ["cookbooks", "for-recipe", recipeId],
    queryFn: () => api.get<RecipeCookbookHit[]>(`/recipes/${recipeId}/cookbooks`),
    enabled: !!recipeId,
    staleTime: 30_000,
  })
}

export function useCreateCookbook() {
  const qc = useQueryClient()
  return useMutation<
    Cookbook,
    Error,
    { name: string; description?: string | null; emoji?: string | null }
  >({
    mutationFn: (body) => api.post<Cookbook>("/cookbooks", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cookbooks"] }),
  })
}

export function usePatchCookbook() {
  const qc = useQueryClient()
  return useMutation<
    Cookbook,
    Error,
    {
      id: string
      patch: Partial<{ name: string; description: string | null; emoji: string | null }>
    }
  >({
    mutationFn: ({ id, patch }) => api.patch<Cookbook>(`/cookbooks/${id}`, patch),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["cookbooks"] })
      qc.invalidateQueries({ queryKey: ["cookbooks", vars.id] })
    },
  })
}

export function useDeleteCookbook() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => api.delete<void>(`/cookbooks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cookbooks"] }),
  })
}

export function useAddRecipeToCookbook() {
  const qc = useQueryClient()
  return useMutation<void, Error, { cookbookId: string; recipeId: string }>({
    mutationFn: ({ cookbookId, recipeId }) =>
      api.post<void>(`/cookbooks/${cookbookId}/recipes/${recipeId}`, {}),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["cookbooks"] })
      qc.invalidateQueries({ queryKey: ["cookbooks", vars.cookbookId] })
      qc.invalidateQueries({ queryKey: ["cookbooks", "for-recipe", vars.recipeId] })
    },
  })
}

export function useRemoveRecipeFromCookbook() {
  const qc = useQueryClient()
  return useMutation<void, Error, { cookbookId: string; recipeId: string }>({
    mutationFn: ({ cookbookId, recipeId }) =>
      api.delete<void>(`/cookbooks/${cookbookId}/recipes/${recipeId}`),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["cookbooks"] })
      qc.invalidateQueries({ queryKey: ["cookbooks", vars.cookbookId] })
      qc.invalidateQueries({ queryKey: ["cookbooks", "for-recipe", vars.recipeId] })
    },
  })
}
