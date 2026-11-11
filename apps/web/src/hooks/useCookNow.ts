/** «Cocinar ahora» (specs/cook-now.md): the meal of now, the proposal, Mimo's line and «Cocinar esta». */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CookNowChooseRequest, CookNowMeal, CookNowProposalRequest, DisplaceTarget } from "@ona/shared"
import { api } from "@/lib/api"
import { pantryMatchBody } from "@/lib/cookNowPayload"

export interface CookNowPlannedDish {
  recipeId: string
  recipeName: string
  imageUrl: string | null
  totalTime: number | null
}

export interface CookNowToday {
  weekStart: string
  day: number
  meal: CookNowMeal | null
  menuId: string | null
  planned: CookNowPlannedDish[]
  locked: boolean
  slotServings: number | null
  targets: DisplaceTarget[]
}

export interface CookNowItem {
  recipe: { id: string; name: string; imageUrl: string | null; totalTime: number | null }
  fit: "fits" | "margin"
  missingEssential: string[]
  short: string[]
  missingSecondary: string[]
  substitutions: Array<{ missing: string; use: string }>
  uses: string[]
  expiring: string[]
}

export interface CookNowProposal {
  meal: CookNowMeal | null
  fallback: boolean
  items: CookNowItem[]
}

export type CookNowChooseResult =
  | { placed: true; menuId: string; weekStart: string; day: number; meal: string }
  | { placed: false; reason: "no_meal" | "locked" | "not_found" | "banned" }

export function useCookNowToday() {
  return useQuery<CookNowToday>({ queryKey: ["cook-now", "today"], queryFn: () => api.get<CookNowToday>("/cook-now/today") })
}

export function useCookNowProposal() {
  return useMutation<CookNowProposal, Error, CookNowProposalRequest>({
    mutationFn: (body) => api.post<CookNowProposal>("/cook-now/proposal", body),
  })
}

/** «Con lo que tienes»: the proposal with the default answers, only what uses the pantry. */
export function useCookNowPantryMatches(servings: number) {
  return useQuery<CookNowProposal>({
    queryKey: ["cook-now", "pantry-match", servings],
    queryFn: () => api.post<CookNowProposal>("/cook-now/proposal", pantryMatchBody(servings)),
    staleTime: 60_000,
  })
}

export function useCookNowPhrase(recipeId: string | null) {
  return useQuery<{ text: string | null }>({
    queryKey: ["cook-now", "phrase", recipeId],
    queryFn: () => api.post<{ text: string | null }>("/cook-now/phrase", { recipeId }),
    enabled: !!recipeId,
    staleTime: Infinity,
    retry: false,
  })
}

export function useCookNowChoose() {
  const qc = useQueryClient()
  return useMutation<CookNowChooseResult, Error, CookNowChooseRequest>({
    mutationFn: (body) => api.post<CookNowChooseResult>("/cook-now/choose", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["menu"] })
      qc.invalidateQueries({ queryKey: ["cook-now"] })
    },
  })
}
