/**
 * «¿Cómo cocináis en casa?» (PRO-217): the household's answer in its ficha.
 * Perfil and Mimo's `set_cooking_style` write through the same route.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { COOKING_STYLE_PATH, type CookingStyle } from "@ona/shared"

export interface CookingStyleState {
  style: CookingStyle | null
  canEdit: boolean
}

export function useCookingStyle() {
  return useQuery<CookingStyleState>({
    queryKey: ["household", "cooking-style"],
    queryFn: () => api.get<CookingStyleState>(COOKING_STYLE_PATH),
  })
}

export function useSetCookingStyle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (style: CookingStyle) => api.put<{ style: CookingStyle; changed: boolean }>(COOKING_STYLE_PATH, { style }),
    onSuccess: (out) => {
      qc.setQueryData<CookingStyleState>(["household", "cooking-style"], (prev) => ({ canEdit: prev?.canEdit ?? true, style: out.style }))
    },
  })
}
