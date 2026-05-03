/**
 * Admin dashboard hooks (formerly Curator).
 *
 * Wraps every read endpoint that surfaces catalog gaps + the small write
 * endpoints (PATCH /ingredients/:id, PATCH /ingredients/:id/remap), plus
 * the user-management + audit-log endpoints behind /admin/*.
 *
 * All reads invalidate cleanly so a single mutation propagates to every
 * gap section in one tick. Catalog query keys stay namespaced under
 * "curator" for historical reasons; users / audit-log use "admin".
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Aisle, Ingredient } from "@ona/shared"

export interface IngredientGapsResponse {
  missingFdcId: Array<{
    id: string
    name: string
    aisle: Aisle | null
    allergenTags: string[] | null
  }>
  missingDensity: Array<{ id: string; name: string; aisle: Aisle | null }>
  missingUnitWeight: Array<{ id: string; name: string; aisle: Aisle | null }>
  aisleOtros: Array<{ id: string; name: string }>
  allergenSuggestions: Array<{
    id: string
    name: string
    currentTags: string[]
    suggestedTags: string[]
  }>
}

export interface RecipeGapsResponse {
  missingNutrition: Array<{
    id: string
    name: string
    kcal: number
    missingIngredientIds: string[]
  }>
  missingTotalTime: Array<{ id: string; name: string }>
  missingEquipment: Array<{ id: string; name: string }>
  missingDifficulty: Array<{ id: string; name: string; difficulty: string }>
}

export interface RegenEntry {
  source: "failed" | "skipped"
  recipeName: string
  errors: Array<{ code?: string; message?: string; path?: string }>
  warnings: Array<{ code?: string; message?: string; path?: string }>
}

export function useIngredientGaps() {
  return useQuery<IngredientGapsResponse>({
    queryKey: ["curator", "ingredient-gaps"],
    queryFn: () => api.get<IngredientGapsResponse>("/admin/ingredient-gaps"),
    staleTime: 30 * 1000,
  })
}

export function useRecipeGaps() {
  return useQuery<RecipeGapsResponse>({
    queryKey: ["curator", "recipe-gaps"],
    queryFn: () => api.get<RecipeGapsResponse>("/admin/recipe-gaps"),
    staleTime: 30 * 1000,
  })
}

export function useRegenOutput() {
  return useQuery<RegenEntry[]>({
    queryKey: ["curator", "regen-output"],
    queryFn: () => api.get<RegenEntry[]>("/admin/regen-output"),
    staleTime: 60 * 1000,
  })
}

interface PatchInput {
  id: string
  body: {
    aisle?: Aisle | null
    density?: number | null
    unitWeight?: number | null
    allergenTags?: string[]
  }
}

export function usePatchIngredient() {
  const qc = useQueryClient()
  return useMutation<Ingredient, Error, PatchInput>({
    mutationFn: ({ id, body }) => api.patch<Ingredient>(`/ingredients/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["curator"] })
      qc.invalidateQueries({ queryKey: ["ingredients"] })
    },
  })
}

export function useRemapIngredient() {
  const qc = useQueryClient()
  return useMutation<Ingredient, Error, { id: string; fdcId: number }>({
    mutationFn: ({ id, fdcId }) =>
      api.patch<Ingredient>(`/ingredients/${id}/remap`, { fdcId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["curator"] })
      qc.invalidateQueries({ queryKey: ["ingredients"] })
    },
  })
}

// ════════════════════════════════════════════════════════════════
// User management
// ════════════════════════════════════════════════════════════════

export interface AdminUserRow {
  id: string
  username: string
  email: string
  role: "user" | "admin"
  suspendedAt: string | null
  createdAt: string
  lastLoginAt: string | null
}

export interface AdminUsersListResponse {
  rows: AdminUserRow[]
  total: number
  page: number
  perPage: number
}

export interface AdminUsersListQuery {
  search?: string
  suspended?: boolean
  page?: number
  perPage?: number
}

function buildQuery(params: object): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

export function useAdminUsersList(query: AdminUsersListQuery = {}) {
  return useQuery<AdminUsersListResponse>({
    queryKey: ["admin", "users", query],
    queryFn: () =>
      api.get<AdminUsersListResponse>(`/admin/users${buildQuery(query)}`),
    staleTime: 15 * 1000,
  })
}

export interface AdminUserDetail {
  id: string
  username: string
  email: string
  role: "user" | "admin"
  suspendedAt: string | null
  createdAt: string
  lastLoginAt: string | null
  sex: string | null
  age: number | null
  weight: number | null
  height: number | null
  activityLevel: string | null
  householdSize: string | null
  adults: number | null
  kidsCount: number | null
  cookingFreq: string | null
  restrictions: string[] | null
  favoriteDishes: string[] | null
  priority: string | null
  onboardingDone: boolean | null
  recetasCreadas: number
  menusGenerados: number
  [key: string]: unknown
}

export function useAdminUserDetail(id: string | null) {
  return useQuery<AdminUserDetail>({
    queryKey: ["admin", "users", "detail", id],
    queryFn: () => api.get<AdminUserDetail>(`/admin/users/${id}`),
    enabled: id != null,
    staleTime: 5 * 1000,
  })
}

export function useAdminSuspendUser() {
  const qc = useQueryClient()
  return useMutation<{ ok: true; suspendedAt: string }, Error, string>({
    mutationFn: (id) => api.post(`/admin/users/${id}/suspend`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] })
      qc.invalidateQueries({ queryKey: ["admin", "users", "detail", id] })
      qc.invalidateQueries({ queryKey: ["admin", "audit-log"] })
    },
  })
}

export function useAdminUnsuspendUser() {
  const qc = useQueryClient()
  return useMutation<{ ok: true; suspendedAt: string | null }, Error, string>({
    mutationFn: (id) => api.post(`/admin/users/${id}/unsuspend`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] })
      qc.invalidateQueries({ queryKey: ["admin", "users", "detail", id] })
      qc.invalidateQueries({ queryKey: ["admin", "audit-log"] })
    },
  })
}

export interface AdminResetTokenResponse {
  token: string
  link: string
  expires_at: string
}

export function useAdminResetPasswordToken() {
  const qc = useQueryClient()
  return useMutation<AdminResetTokenResponse, Error, string>({
    mutationFn: (id) =>
      api.post<AdminResetTokenResponse>(
        `/admin/users/${id}/reset-password-token`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "audit-log"] })
    },
  })
}

// ════════════════════════════════════════════════════════════════
// Audit log
// ════════════════════════════════════════════════════════════════

export interface AdminAuditEntry {
  id: string
  adminId: string
  adminUsername: string | null
  adminEmail: string | null
  action: string
  targetType: string | null
  targetId: string | null
  payload: Record<string, unknown> | null
  createdAt: string
}

export interface AdminAuditLogResponse {
  rows: AdminAuditEntry[]
  total: number
  page: number
  perPage: number
}

export interface AdminAuditLogFilters {
  adminId?: string
  action?: string
  from?: string
  to?: string
  page?: number
  perPage?: number
}

export function useAdminAuditLog(filters: AdminAuditLogFilters = {}) {
  return useQuery<AdminAuditLogResponse>({
    queryKey: ["admin", "audit-log", filters],
    queryFn: () =>
      api.get<AdminAuditLogResponse>(`/admin/audit-log${buildQuery(filters)}`),
    staleTime: 10 * 1000,
  })
}
