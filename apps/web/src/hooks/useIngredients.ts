/**
 * Ingredient hooks: catalog search + auto-create flow.
 *
 * `useSearchIngredients(query)` — debounced filtered list against the
 *   existing GET /ingredients?search= endpoint. Empty query returns the
 *   first page (perPage=20).
 *
 * `useSuggestIngredient(name, enabled, query?)` — query wrapping
 *   GET /ingredients/suggest. Used by the auto-create / re-map modals to
 *   surface USDA / BEDCA candidates after the user opts to create. Pass
 *   `query` to override the automatic es→en translation (curators
 *   refining a poor auto-search).
 *
 * `useAutoCreateIngredient()` — mutation hitting POST /ingredients/auto-create.
 *   Invalidates the `["ingredients"]` cache so the recipe form sees the new
 *   row immediately.
 *
 * `useEstimateNutrition(id)` — mutation hitting
 *   POST /ingredients/:id/estimate-nutrition. Last-resort estimate via Claude
 *   when both USDA and BEDCA miss.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Aisle, Ingredient } from "@ona/shared"

export interface AutoCreateCandidate {
  /** USDA fdcId; null for BEDCA-sourced rows */
  fdcId: number | null
  /** BEDCA food id; null for USDA-sourced rows */
  bedcaId: string | null
  description: string
  /** Spanish translation of `description` (null when translation skipped/failed). */
  descriptionEs: string | null
  /** 'Foundation' | 'SR Legacy' | 'Survey (FNDDS)' | 'BEDCA' */
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
  queryUsed: string
}

export interface AutoCreateInput {
  name: string
  fdcId?: number | null
  bedcaId?: string | null
  /** Direct per-100 g nutrition for the manual / estimated path. */
  nutrition?: {
    kcal: number
    proteinG: number
    carbsG: number
    fatG: number
    fiberG: number
    saltG: number
  } | null
  aisle?: Aisle | null
  density?: number | null
  unitWeight?: number | null
}

export interface AutoCreateResponse {
  ingredient: Ingredient
  /** Present when the input fuzzy-matched an existing row. */
  dedupedFrom?: string
}

export interface EstimateNutritionResponse {
  ingredient: Ingredient
  source: "estimated"
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

/**
 * Fetch USDA / BEDCA candidates for a given Spanish name.
 *
 * @param name — original ingredient name (used as the row's identity / fallback)
 * @param enabled — gate the query
 * @param query — optional override sent to USDA verbatim (skips es→en).
 *                Curators use this to refine a poor automatic translation.
 */
export function useSuggestIngredient(
  name: string,
  enabled: boolean = true,
  query?: string,
) {
  const trimmed = name.trim()
  const trimmedQuery = (query ?? "").trim()
  return useQuery<AutoCreateSuggestion>({
    queryKey: ["ingredients", "suggest", trimmed.toLowerCase(), trimmedQuery.toLowerCase()],
    queryFn: () => {
      const params = new URLSearchParams({ name: trimmed })
      if (trimmedQuery.length > 0) params.set("query", trimmedQuery)
      return api.get<AutoCreateSuggestion>(`/ingredients/suggest?${params.toString()}`)
    },
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

export interface EstimateNutritionPreviewResponse {
  nutrition: {
    kcal: number
    proteinG: number
    carbsG: number
    fatG: number
    fiberG: number
    saltG: number
  }
  source: "estimated"
}

/**
 * Preview-only estimate (no DB write). Used by the auto-create modal
 * where the ingredient row doesn't yet exist. Curator confirms in the
 * modal, then the auto-create POST persists the values via the
 * `nutrition` field.
 */
export function useEstimateNutritionPreview() {
  return useMutation<EstimateNutritionPreviewResponse, Error, { name: string }>({
    mutationFn: ({ name }) =>
      api.post<EstimateNutritionPreviewResponse>("/ingredients/estimate-nutrition", {
        name,
      }),
  })
}

/**
 * Estimate per-100 g nutrition via Claude when USDA + BEDCA both miss.
 * Persists the estimated values onto the ingredient row directly
 * (`fdc_id` stays null) and invalidates the catalog cache.
 */
export function useEstimateNutrition(ingredientId: string | null) {
  const queryClient = useQueryClient()
  return useMutation<EstimateNutritionResponse, Error, { name?: string } | void>({
    mutationFn: (input) => {
      if (!ingredientId) {
        return Promise.reject(new Error("Falta el id del ingrediente."))
      }
      return api.post<EstimateNutritionResponse>(
        `/ingredients/${ingredientId}/estimate-nutrition`,
        input ?? {},
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ingredients"] })
      queryClient.invalidateQueries({ queryKey: ["curator"] })
    },
  })
}
