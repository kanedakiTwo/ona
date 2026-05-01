import { useQuery, useMutation } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useAdvisorSummary(userId: string | undefined) {
  return useQuery<any>({
    queryKey: ["advisor-summary", userId],
    queryFn: () => api.get(`/advisor/${userId}/summary`),
    enabled: !!userId,
  })
}

export function useAskAdvisor() {
  return useMutation({
    mutationFn: (params: { userId: string; question: string }) =>
      api.post<any>(`/advisor/${params.userId}/ask`, {
        question: params.question,
      }),
  })
}
