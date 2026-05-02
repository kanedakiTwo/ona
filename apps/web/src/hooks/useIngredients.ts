/**
 * Ingredient hooks: catalog search + auto-create flow.
 *
 * `useSearchIngredients(query)` — debounced filtered list against the
 *   existing GET /ingredients?search= endpoint. Empty query returns the
 *   first page (perPage=20).
 *
 * `useSuggestIngredient(name)` — POST-style mutation wrapping
 *   GET /ingredients/suggest. Used by the auto-create modal to surface
 *   USDA candidates after the user opts to create a new ingredient.
 *
 * `useAutoCreateIngredient()` — mutation hitting POST /ingredients/auto-create.
 *   Invalidates the `["ingredients"]` cache so the recipe form sees the new
 *   row immediately.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Aisle, Ingredient } from "@ona/shared"

export interface AutoCreateCandidate {
  fdcId: number
  description: string
  dataType: string
  per100g: {
    kcal: number
    proteinG: number
    carbsG: number
    fatG: number
    fiberG: number
    saltG: number
  }
}

export interface AutoCreateSuggestion {
  normalizedName: string
  candidates: AutoCreateCandidate[]
  suggestedAisle: Aisle
  suggestedAllergens: string[]
}

export interface AutoCreateInput {
  name: string
  fdcId?: number | null
  aisle?: Aisle | null
  density?: number | null
  unitWeight?: number | null
}

export interface AutoCreateResponse {
  ingredient: Ingredient
  /** Present when the input fuzzy-matched an existing row. */
  dedupedFrom?: string
}

/** Debounced server-side search against the catalog. */
export function useSearchIngredients(query: string) {
  const trimmed = query.trim()
  return useQuery<Ingredient[]>({
    queryKey: ["ingredients", "search", trimmed.toLowerCase()],
    queryFn: () => {
      const qs = trimmed.length > 0 ? `?search=${encodeURIComponent(trimmed)}&perPage=20` : "?perPage=20"
      return api.get<Ingredient[]>(`/ingredients${qs}`)
    },
    staleTime: 30 * 1000,
    // We always fetch — `query=""` is the "show me the top 20" call.
    enabled: true,
  })
}

/** Fetch USDA candidates for a given Spanish name (auto-create modal). */
export function useSuggestIngredient(name: string, enabled: boolean = true) {
  const trimmed = name.trim()
  return useQuery<AutoCreateSuggestion>({
    queryKey: ["ingredients", "suggest", trimmed.toLowerCase()],
    queryFn: () => api.get<AutoCreateSuggestion>(`/ingredients/suggest?name=${encodeURIComponent(trimmed)}`),
    enabled: enabled && trimmed.length >= 2,
    staleTime: 5 * 60 * 1000,
    // USDA can rate-limit — don't retry aggressively.
    retry: 1,
  })
}

/** Persist a new ingredient via the auto-create endpoint. */
export function useAutoCreateIngredient() {
  const queryClient = useQueryClient()
  return useMutation<AutoCreateResponse, Error, AutoCreateInput>({
    mutationFn: (input: AutoCreateInput) =>
      api.post<AutoCreateResponse>("/ingredients/auto-create", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ingredients"] })
    },
  })
}
