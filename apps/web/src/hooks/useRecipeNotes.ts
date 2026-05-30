/**
 * Recipe-notes hooks (PR 7) — household-shared notes / rating / substitutions
 * per recipe.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { IngredientOverride } from "@ona/shared"
import { api } from "@/lib/api"

export interface RecipeNotes {
  householdId: string
  recipeId: string
  notes: string | null
  rating: number | null
  substitutions: string | null
  /** PR 8B — per-(household, recipe) free-form tags. Always an array. */
  customTags: string[]
  /**
   * Structured ingredient edits the household applies to this recipe — the
   * recipe detail uses these to render removed lines struck-through, modified
   * lines with the new value next to the original, and added lines with a
   * subtle highlight. Always an array (possibly empty).
   */
  ingredientOverrides: IngredientOverride[]
  lastEditedByUserId: string | null
  lastEditedByUsername: string | null
  createdAt: string
  updatedAt: string
}

export interface NotesPatch {
  notes?: string | null
  rating?: number | null
  substitutions?: string | null
  customTags?: string[]
  ingredientOverrides?: IngredientOverride[]
}

export interface HouseholdCustomTag {
  tag: string
  count: number
}

/** All distinct custom tags in the household with their usage counts. */
export function useHouseholdCustomTags() {
  return useQuery<HouseholdCustomTag[]>({
    queryKey: ["custom-tags"],
    queryFn: () => api.get<HouseholdCustomTag[]>("/custom-tags"),
    staleTime: 60_000,
  })
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
