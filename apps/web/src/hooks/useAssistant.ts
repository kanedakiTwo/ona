import { useMutation } from "@tanstack/react-query"
import { api } from "@/lib/api"

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AssistantResponse {
  message: string
  skillUsed?: string
  data?: any
  uiHint?: string
  actionTaken?: boolean
}

export function useAssistantChat() {
  return useMutation({
    mutationFn: (params: { userId: string; message: string; history?: ChatMessage[] }) =>
      api.post<AssistantResponse>(`/assistant/${params.userId}/chat`, {
        message: params.message,
        history: params.history ?? [],
      }),
  })
}
