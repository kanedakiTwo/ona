/**
 * «Tu semana tipo» (D-182): the household's usual week. Each change writes
 * one slot (`PUT /households/me/week-type/:day/:meal`) and shows at once.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Meal, WeekTypeDays, WeekTypeSlot } from "@ona/shared"
import { api } from "@/lib/api"

const KEY = ["week-type"]

export function useWeekType() {
  return useQuery<WeekTypeDays>({
    queryKey: KEY,
    queryFn: async () => (await api.get<{ days: WeekTypeDays }>("/households/me/week-type")).days,
    staleTime: 30_000,
  })
}

export function useSaveWeekTypeSlot() {
  const qc = useQueryClient()
  return useMutation<WeekTypeDays, Error, { day: number; meal: Meal; slot: WeekTypeSlot }, { before?: WeekTypeDays }>({
    mutationFn: async ({ day, meal, slot }) => (await api.put<{ days: WeekTypeDays }>(`/households/me/week-type/${day}/${meal}`, slot)).days,
    onMutate: async ({ day, meal, slot }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const before = qc.getQueryData<WeekTypeDays>(KEY)
      if (before) {
        const next = before.map((d) => ({ ...d }))
        next[day] = { ...next[day], [meal]: slot }
        qc.setQueryData(KEY, next)
      }
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(KEY, ctx.before)
    },
    onSuccess: (days) => qc.setQueryData(KEY, days),
  })
}
