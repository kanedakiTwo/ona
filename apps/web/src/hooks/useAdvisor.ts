import { useQuery, useMutation } from "@tanstack/react-query"
import { api } from "@/lib/api"

interface AdvisorSummary {
  score: number
  insights: string[]
  suggestions: string[]
}

interface AdvisorResponse {
  answer: string
}

export function useAdvisorSummary(userId: string | undefined) {
  return useQuery<AdvisorSummary>({
    queryKey: ["advisor-summary", userId],
    queryFn: () => api.get(`/advisor/${userId}/summary`),
    enabled: !!userId,
  })
}

export function useAskAdvisor() {
  return useMutation({
    mutationFn: (params: { userId: string; question: string }) =>
      api.post<AdvisorResponse>(`/advisor/${params.userId}/ask`, {
        question: params.question,
      }),
  })
}
