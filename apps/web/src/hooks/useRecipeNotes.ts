/**
 * Recipe-notes hooks (PR 7) — household-shared notes / rating / substitutions
 * per recipe.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface RecipeNotes {
  householdId: string
  recipeId: string
  notes: string | null
  rating: number | null
  substitutions: string | null
  lastEditedByUserId: string | null
  lastEditedByUsername: string | null
  createdAt: string
  updatedAt: string
}

export interface NotesPatch {
  notes?: string | null
  rating?: number | null
  substitutions?: string | null
}

/** Returns `null` when no row exists yet. */
export function useRecipeNotes(recipeId: string | undefined) {
  return useQuery<RecipeNotes | null>({
    queryKey: ["recipe-notes", recipeId],
    queryFn: () => api.get<RecipeNotes | null>(`/recipes/${recipeId}/notes`),
    enabled: !!recipeId,
    staleTime: 30_000,
  })
}

export function useSaveRecipeNotes(recipeId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<RecipeNotes, Error, NotesPatch>({
    mutationFn: (patch) => api.put<RecipeNotes>(`/recipes/${recipeId}/notes`, patch),
    onSuccess: (data) => {
      qc.setQueryData(["recipe-notes", recipeId], data)
    },
  })
}
