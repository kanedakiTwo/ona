/**
 * Cook-from-pantry hook (PR 12). Returns top N recipes ranked by what
 * fraction of their required ingredients the household has on hand.
 */
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface PantryMatchHit {
  recipe: {
    id: string
    name: string
    imageUrl: string | null
    totalTime: number | null
  }
  coverage: number
  matchedCount: number
  totalRequired: number
  missing: string[]
}

export function usePantryMatches(limit: number = 3) {
  return useQuery<PantryMatchHit[]>({
    queryKey: ["pantry-match", limit],
    queryFn: () => api.get<PantryMatchHit[]>(`/recipes/match-pantry?limit=${limit}`),
    staleTime: 60_000,
  })
}
