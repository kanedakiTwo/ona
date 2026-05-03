import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface ImageGenQuota {
  used: number
  limit: number
  monthKey: string
}

export interface UserProfile {
  id: string
  username: string
  email: string
  role?: "user" | "admin"
  /** AI image-generation quota for the current month. Reset implicitly when monthKey rolls over. */
  imageGenQuota?: ImageGenQuota
  // …other profile fields are returned by GET /user/:id but unused here
  [k: string]: unknown
}

/**
 * Fetch a user profile (with the live image-gen quota) via GET /user/:id.
 * Used by the recipe-detail "Regenerar imagen" affordance to render the
 * "(X/20 este mes)" counter before the user clicks. Cache key matches
 * `["user", id]` so `useRegenerateRecipeImage` can invalidate it on success.
 */
export function useUser(id: string | undefined) {
  return useQuery<UserProfile>({
    queryKey: ["user", id],
    queryFn: () => api.get<UserProfile>(`/user/${id}`),
    enabled: !!id,
    // The quota is read-mostly state that only changes on regenerate; let
    // the page show the cached value while we revalidate in the background.
    staleTime: 60_000,
  })
}
