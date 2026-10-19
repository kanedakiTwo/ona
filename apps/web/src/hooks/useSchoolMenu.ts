"use client"

/** Menú del cole (PRO-224): GET / read / save, household scope. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { SchoolLunch } from "@ona/shared"

export interface SchoolMenuResponse {
  days: SchoolLunch[]
  /** The app shows «Menú del cole» only with a child in the household. */
  visible: boolean
  from: string
  to: string
}

export function useSchoolMenu() {
  return useQuery({
    queryKey: ["school-menu"],
    queryFn: () => api.get<SchoolMenuResponse>("/school-menu"),
  })
}

export function useReadSchoolMenu() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      return api.upload<{ days: SchoolLunch[] }>("/school-menu/read", formData)
    },
  })
}

export function useSaveSchoolMenu() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { days: SchoolLunch[]; clear?: string[] }) => api.put<{ ok: true }>("/school-menu", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["school-menu"] }),
  })
}
