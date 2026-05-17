/**
 * User-memory TanStack hooks.
 *
 * Read the full memory blob with `useUserMemory()`; mutate one fact or a
 * batch with `useUpdateMemory()`. Delete with `useDeleteMemoryFact(key)`.
 *
 * The shape mirrors @ona/shared `UserMemory`: a partial record keyed by
 * canonical memory keys, value as MemoryFact { value, source, confidence,
 * updatedAt }. Missing keys are absent (no nulls) so the consumer can use
 * `memory?.dislikes?.value` without null checks.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { UserMemory, MemoryKey, MemorySource } from "@ona/shared"

export function useUserMemory() {
  return useQuery<UserMemory>({
    queryKey: ["memory"],
    queryFn: () => api.get<UserMemory>("/memory"),
    staleTime: 30_000,
  })
}

/** PATCH /memory with one fact OR a batch. The store enforces canonical keys. */
export function useUpdateMemory() {
  const queryClient = useQueryClient()
  return useMutation<
    UserMemory | { key: string; value: unknown; source: MemorySource; confidence: number; updatedAt: string },
    Error,
    | { key: MemoryKey; value: unknown; confidence?: number }
    | { facts: Array<{ key: MemoryKey; value: unknown; confidence?: number }> }
  >({
    mutationFn: (body) => api.patch("/memory", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory"] })
    },
  })
}

/** DELETE /memory/:key. 204 on success; idempotent. */
export function useDeleteMemoryFact() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { key: MemoryKey }>({
    mutationFn: (params) => api.delete(`/memory/${params.key}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory"] })
    },
  })
}
