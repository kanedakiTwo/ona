"use client"

/**
 * MyRecipesSection — "Mis recetas" card inside /profile.
 *
 * Shows every recipe the current user authored plus the status pills the
 * admin/recipes-gaps endpoint computes (sin nutrición, ingredientes
 * auto-añadidos, etc.). Each row opens the recipe; its "···" sheet
 * (D · Luz y foto, PRO-39) holds "Editar" and "Eliminar" — the latter
 * soft-checks via native confirm() before firing.
 *
 * Spec: ../../../../specs/recipes-spec.md (cascade behaviour)
 */

import Link from "next/link"
import { useMemo, useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import {
  useDeleteMyRecipe,
  useMyRecipes,
  type MyRecipeRow,
} from "@/hooks/useMyRecipes"
import { MenuSheet, SheetAction } from "@/components/menu/MenuSheet"
import { RecipeCover } from "@/components/menu/RecipeCover"
import { MoreButton } from "./ProfileCards"

const WARN_PILLS = new Set(["sin nutrición", "ingredientes auto-añadidos"])

function pillClass(label: string): string {
  return WARN_PILLS.has(label)
    ? "bg-warn-bg text-terracotta-deep"
    : "border border-border text-ink-muted"
}

export function MyRecipesSection() {
  const { data, isLoading, isError, error } = useMyRecipes()
  const del = useDeleteMyRecipe()
  const [onlyPending, setOnlyPending] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [sheetFor, setSheetFor] = useState<MyRecipeRow | null>(null)

  const filtered = useMemo<MyRecipeRow[]>(() => {
    if (!data?.recipes) return []
    if (!onlyPending) return data.recipes
    return data.recipes.filter(
      (r) =>
        r.statusPills.includes("ingredientes auto-añadidos") ||
        r.statusPills.includes("sin nutrición"),
    )
  }, [data, onlyPending])

  async function handleDelete(r: MyRecipeRow) {
    const ok = window.confirm(
      `¿Eliminar "${r.name}"? Esta acción es permanente y borra los pasos e ingredientes asociados.`,
    )
    if (!ok) return
    setDeletingId(r.id)
    try {
      await del.mutateAsync(r.id)
    } catch (err) {
      window.alert(
        err instanceof Error
          ? err.message
          : "No se pudo eliminar la receta.",
      )
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) {
    return (
      <p className="text-[13px] italic text-ink-muted">Cargando recetas…</p>
    )
  }

  if (isError) {
    return (
      <p className="text-[13px] text-terracotta-deep">
        {error instanceof Error
          ? error.message
          : "No se pudieron cargar tus recetas."}
      </p>
    )
  }

  const counts = data?.counts ?? {
    total: 0,
    sinNutricion: 0,
    ingredientesPendientesRevision: 0,
  }

  return (
    <div>
      {/* Counts strip */}
      <div className="grid grid-cols-3 gap-2">
        <CountTile label="recetas" value={counts.total} />
        <CountTile label="sin nutrición" value={counts.sinNutricion} accent />
        <CountTile
          label="ingredientes pendientes"
          value={counts.ingredientesPendientesRevision}
        />
      </div>

      {/* Filter */}
      <div className="mt-2">
        <label className="inline-flex min-h-[44px] items-center gap-2.5 text-[13px] text-ink-mid">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
            className="h-5 w-5 accent-ink"
          />
          Solo con pendientes
        </label>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="mt-3 text-[13px] italic text-ink-muted">
          {counts.total === 0
            ? "Aún no has creado recetas."
            : "Sin recetas pendientes en este filtro."}
        </p>
      ) : (
        <ul className="mt-2 overflow-hidden rounded-2xl border border-border-soft bg-paper">
          {filtered.map((r, idx) => (
            <li
              key={r.id}
              className={`flex items-center gap-3 py-2 pl-2 pr-1.5 ${
                idx === 0 ? "" : "border-t border-border-soft"
              } ${deletingId === r.id ? "opacity-50" : ""}`}
            >
              <Link
                href={`/recipes/${r.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-ink"
              >
                <RecipeCover
                  src={r.imageUrl}
                  name={r.name}
                  className="h-12 w-12 shrink-0 rounded-[12px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-serif-text text-[15px] font-[650] text-ink">
                      {r.name}
                    </span>
                    {r.kcal != null && (
                      <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                        {Math.round(r.kcal)} kcal
                      </span>
                    )}
                  </span>
                  {r.statusPills.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {r.statusPills.map((p) => (
                        <span
                          key={p}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${pillClass(p)}`}
                        >
                          {p}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </Link>
              <MoreButton onClick={() => setSheetFor(r)} label={`Opciones de ${r.name}`} />
            </li>
          ))}
        </ul>
      )}

      <MenuSheet
        open={sheetFor !== null}
        onClose={() => setSheetFor(null)}
        eyebrow="Mis recetas"
        title={sheetFor?.name ?? ""}
      >
        {sheetFor && (
          <div className="flex flex-col gap-1">
            <SheetAction icon={Pencil} label="Editar" href={`/recipes/${sheetFor.id}`} />
            <SheetAction
              icon={Trash2}
              label="Eliminar"
              hint="Borra la receta con sus pasos e ingredientes"
              destructive
              disabled={deletingId === sheetFor.id}
              onClick={() => {
                const r = sheetFor
                setSheetFor(null)
                handleDelete(r)
              }}
            />
          </div>
        )}
      </MenuSheet>
    </div>
  )
}

function CountTile({
  label,
  value,
  accent = false,
}: {
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div className="rounded-2xl border border-border-soft bg-cream p-3 text-center">
      <div
        className={`font-serif-text text-[24px] font-[650] leading-none ${
          accent && value > 0 ? "text-terracotta-deep" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-ink-muted">
        {label}
      </div>
    </div>
  )
}
