/**
 * Curator dashboard hooks.
 *
 * Wraps the read endpoints that surface catalog gaps + the small write
 * endpoints (PATCH /ingredients/:id, PATCH /ingredients/:id/remap).
 *
 * All reads invalidate cleanly so a single mutation propagates to every
 * gap section in one tick.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Aisle, Ingredient } from "@ona/shared"

export interface IngredientGapsResponse {
  missingFdcId: Array<{
    id: string
    name: string
    aisle: Aisle | null
    allergenTags: string[] | null
  }>
  missingDensity: Array<{ id: string; name: string; aisle: Aisle | null }>
  missingUnitWeight: Array<{ id: string; name: string; aisle: Aisle | null }>
  aisleOtros: Array<{ id: string; name: string }>
  allergenSuggestions: Array<{
    id: string
    name: string
    currentTags: string[]
    suggestedTags: string[]
  }>
}

export interface RecipeGapsResponse {
  missingNutrition: Array<{
    id: string
    name: string
    kcal: number
    missingIngredientIds: string[]
  }>
  missingTotalTime: Array<{ id: string; name: string }>
  missingEquipment: Array<{ id: string; name: string }>
  missingDifficulty: Array<{ id: string; name: string; difficulty: string }>
}

export interface RegenEntry {
  source: "failed" | "skipped"
  recipeName: string
  errors: Array<{ code?: string; message?: string; path?: string }>
  warnings: Array<{ code?: string; message?: string; path?: string }>
}

export function useIngredientGaps() {
  return useQuery<IngredientGapsResponse>({
    queryKey: ["curator", "ingredient-gaps"],
    queryFn: () => api.get<IngredientGapsResponse>("/curator/ingredient-gaps"),
    staleTime: 30 * 1000,
  })
}

export function useRecipeGaps() {
  return useQuery<RecipeGapsResponse>({
    queryKey: ["curator", "recipe-gaps"],
    queryFn: () => api.get<RecipeGapsResponse>("/curator/recipe-gaps"),
    staleTime: 30 * 1000,
  })
}

export function useRegenOutput() {
  return useQuery<RegenEntry[]>({
    queryKey: ["curator", "regen-output"],
    queryFn: () => api.get<RegenEntry[]>("/curator/regen-output"),
    staleTime: 60 * 1000,
  })
}

interface PatchInput {
  id: string
  body: {
    aisle?: Aisle | null
    density?: number | null
    unitWeight?: number | null
    allergenTags?: string[]
  }
}

export function usePatchIngredient() {
  const qc = useQueryClient()
  return useMutation<Ingredient, Error, PatchInput>({
    mutationFn: ({ id, body }) => api.patch<Ingredient>(`/ingredients/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["curator"] })
      qc.invalidateQueries({ queryKey: ["ingredients"] })
    },
  })
}

export function useRemapIngredient() {
  const qc = useQueryClient()
  return useMutation<Ingredient, Error, { id: string; fdcId: number }>({
    mutationFn: ({ id, fdcId }) =>
      api.patch<Ingredient>(`/ingredients/${id}/remap`, { fdcId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["curator"] })
      qc.invalidateQueries({ queryKey: ["ingredients"] })
    },
  })
}
