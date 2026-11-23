"use client"

/**
 * «Quién come» (PRO-1203): the people of the house, one row each.
 * Mirrors `HouseholdPeopleView` in apps/api/src/services/householdPeople.ts.
 * Adding, editing and removing a person without an account goes through the
 * ficha's endpoints (as «+ Persona» in «Tu ficha»); the API moves the size of
 * the house with them.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type SizeGroup = "adult" | "kid" | "none"

export interface PersonRow {
  /** `me`, the member's user id, the person's id, or `extra-adult-1` / `extra-kid-1`. */
  id: string
  kind: "me" | "member" | "person" | "extra"
  name: string
  role: "owner" | "member" | "child" | null
  ageBand: string | null
  group: SizeGroup
  /** null: another member's (theirs to say). */
  restrictions: string[] | null
  answered: boolean | null
  dislikes: string[] | null
  canEdit: boolean
}

export interface HouseholdPeopleView {
  people: PersonRow[]
  counts: { adults: number; kidsCount: number }
  healthConsent: boolean
  canEdit: boolean
}

export const PEOPLE_KEY = ["household", "people"] as const

async function invalidatePeople(qc: QueryClient) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: PEOPLE_KEY }),
    qc.invalidateQueries({ queryKey: ["ficha"] }),
    qc.invalidateQueries({ queryKey: ["school-menu"] }),
    qc.invalidateQueries({ queryKey: ["household-allergies"] }),
  ])
}

export function useHouseholdPeople() {
  return useQuery({
    queryKey: PEOPLE_KEY,
    queryFn: () => api.get<HouseholdPeopleView>("/households/me/people"),
  })
}

/** «+ Añadir a alguien que no usa Mimoia» (a minor only with a generic alias: the API says why). */
export function useAddHouseholdPerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { alias: string; ageBand: string }) =>
      api.post<{ id: string; alias: string; ageBand: string }>("/household/profile/persons", input),
    onSuccess: () => invalidatePeople(qc),
  })
}

export function useUpdateHouseholdPerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; alias: string; ageBand: string }) =>
      api.patch<{ id: string; alias: string; ageBand: string }>(`/household/profile/persons/${input.id}`, {
        alias: input.alias,
        ageBand: input.ageBand,
      }),
    onSuccess: () => invalidatePeople(qc),
  })
}

export function useRemoveHouseholdPerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/household/profile/persons/${id}`),
    onSuccess: () => invalidatePeople(qc),
  })
}

/** The whole list of allergies and diet, or of dislikes, of a person without an account. */
export function useSetPersonList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; list: "restrictions" | "dislikes"; values: string[] }) =>
      api.put<{ values: string[] }>(`/households/me/people/${input.id}/${input.list}`, { values: input.values }),
    onSuccess: () => invalidatePeople(qc),
  })
}

/** «No está»: one fewer adult or child of the ones the counter had and nobody describes. */
export function useRemoveUndescribed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (group: "adult" | "kid") =>
      api.post<{ adults: number; kidsCount: number }>("/households/me/people/undescribed/remove", { group }),
    onSuccess: () => invalidatePeople(qc),
  })
}
