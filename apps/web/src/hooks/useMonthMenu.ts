import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Meal } from "@ona/shared"
import { api } from "@/lib/api"

/** «Menú del mes» (PRO-378, specs/menus.md): the shape of `GET /month-menus/current`. */
export interface MonthMenuDish {
  id: string
  name: string
  imageUrl: string | null
  totalTime: number | null
}

export interface MonthMenu {
  id: string
  /** YYYY-MM. */
  month: string
  /** «Menú de noviembre». */
  title: string
  /** 7 days, Monday first; per meal, the dishes. */
  days: Array<Partial<Record<Meal, MonthMenuDish[]>>>
}

export interface CopyMonthMenuResult {
  menuId: string
  copied: number
  swapped: number
  dropped: number
  /** «Hemos copiado 13 platos a tu semana. Uno no encajaba…». */
  notice: string
}

export function useMonthMenu(enabled = true) {
  return useQuery<MonthMenu | null>({
    queryKey: ["month-menu"],
    queryFn: async () => (await api.get<{ menu: MonthMenu | null }>("/month-menus/current")).menu,
    enabled,
    staleTime: 10 * 60 * 1000,
  })
}

/** 409 MENU_NOT_EMPTY without `force` when the week has dishes: ask first. */
export function useCopyMonthMenu() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (p: { month: string; weekStart: string; force?: boolean }) =>
      api.post<CopyMonthMenuResult>(`/month-menus/${p.month}/copy`, { weekStart: p.weekStart, ...(p.force ? { force: true } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu"] })
      queryClient.invalidateQueries({ queryKey: ["shopping-list"] })
    },
  })
}
