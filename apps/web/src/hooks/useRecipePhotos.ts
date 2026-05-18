/**
 * Recipe-photos hooks (PR 8C). Household-shared gallery on top of the
 * recipe's hero image.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface RecipePhoto {
  id: string
  recipeId: string
  householdId: string
  uploadedByUserId: string | null
  uploadedByUsername: string | null
  imageUrl: string
  caption: string | null
  createdAt: string
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export function useRecipePhotos(recipeId: string | undefined) {
  return useQuery<RecipePhoto[]>({
    queryKey: ["recipe-photos", recipeId],
    queryFn: () => api.get<RecipePhoto[]>(`/recipes/${recipeId}/photos`),
    enabled: !!recipeId,
    staleTime: 30_000,
  })
}

/** Multipart upload — uses raw fetch since the api helper assumes JSON. */
export function useUploadRecipePhoto() {
  const qc = useQueryClient()
  return useMutation<
    RecipePhoto,
    Error,
    { recipeId: string; file: File; caption?: string }
  >({
    mutationFn: async ({ recipeId, file, caption }) => {
      const fd = new FormData()
      fd.append("photo", file)
      if (caption) fd.append("caption", caption)
      const token = typeof window !== "undefined" ? localStorage.getItem("ona_token") : null
      const res = await fetch(`${BASE_URL}/recipes/${recipeId}/photos`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        throw new Error(txt || `Upload failed (${res.status})`)
      }
      return (await res.json()) as RecipePhoto
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["recipe-photos", vars.recipeId] })
    },
  })
}

export function useDeleteRecipePhoto() {
  const qc = useQueryClient()
  return useMutation<void, Error, { recipeId: string; photoId: string }>({
    mutationFn: ({ recipeId, photoId }) =>
      api.delete<void>(`/recipes/${recipeId}/photos/${photoId}`),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["recipe-photos", vars.recipeId] })
    },
  })
}
