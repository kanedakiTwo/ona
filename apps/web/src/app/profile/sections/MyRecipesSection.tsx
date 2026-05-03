"use client"

/**
 * MyRecipesSection — "Mis recetas" tab inside /profile.
 *
 * Shows every recipe the current user authored plus the status pills the
 * admin/recipes-gaps endpoint computes (sin nutrición, ingredientes
 * auto-añadidos, etc.). Each row gets an "Editar" link to the public
 * recipe page and an "Eliminar" mutation that soft-checks via native
 * confirm() before firing.
 *
 * Spec: ../../../../specs/recipes-spec.md (cascade behaviour)
 */

import Link from "next/link"
import Image from "next/image"
import { useMemo, useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import {
  useDeleteMyRecipe,
  useMyRecipes,
  type MyRecipeRow,
} from "@/hooks/useMyRecipes"

const PILL_TONE: Record<string, string> = {
  "sin nutrición": "bg-[#C65D38]/15 text-[#C65D38]",
  "ingredientes auto-añadidos":
    "bg-[#E26A4A]/15 text-[#C65D38]",
  "sin equipo": "border border-[#DDD6C5] text-[#7A7066]",
  "sin tiempo": "border border-[#DDD6C5] text-[#7A7066]",
}

function pillClass(label: string): string {
  return (
    PILL_TONE[label] ??
    "border border-[#DDD6C5] text-[#7A7066]"
  )
}

export function MyRecipesSection() {
  const { data, isLoading, isError, error } = useMyRecipes()
  const del = useDeleteMyRecipe()
  const [onlyPending, setOnlyPending] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
      <p className="text-[12px] italic text-[#7A7066]">Cargando recetas…</p>
    )
  }

  if (isError) {
    return (
      <p className="text-[12px] text-[#C65D38]">
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
        <CountTile label="recetas" value={counts.total} tone="ink" />
        <CountTile
          label="sin nutrición"
          value={counts.sinNutricion}
          tone="terracotta"
        />
        <CountTile
          label="ingredientes pendientes"
          value={counts.ingredientesPendientesRevision}
          tone="cream"
        />
      </div>

      {/* Filter */}
      <div className="mt-4">
        <label className="inline-flex items-center gap-2 text-[12px] text-[#4A4239]">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
            className="h-4 w-4 accent-[#C65D38]"
          />
          Solo con pendientes
        </label>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="mt-6 text-[12px] italic text-[#7A7066]">
          {counts.total === 0
            ? "Aún no has creado recetas."
            : "Sin recetas pendientes en este filtro."}
        </p>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA]">
          {filtered.map((r, idx) => (
            <li
              key={r.id}
              className={`flex gap-3 px-3 py-3 ${
                idx === 0 ? "" : "border-t border-[#DDD6C5]"
              }`}
            >
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[#F2EDE0]">
                {r.imageUrl ? (
                  <Image
                    src={r.imageUrl}
                    alt={r.name}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-[#A39A8E]">
                    sin foto
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[13px] font-medium text-[#1A1612]">
                    {r.name}
                  </span>
                  {r.kcal != null && (
                    <span className="rounded-full bg-[#1A1612] px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[#FAF6EE]">
                      {Math.round(r.kcal)} kcal
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.statusPills.map((p) => (
                    <span
                      key={p}
                      className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] ${pillClass(p)}`}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Link
                  href={`/recipes/${r.id}`}
                  className="flex h-8 items-center gap-1 rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-3 text-[10px] uppercase tracking-[0.1em] text-[#4A4239] hover:border-[#1A1612] hover:text-[#1A1612]"
                >
                  <Pencil size={11} />
                  Editar
                </Link>
                <button
                  onClick={() => handleDelete(r)}
                  disabled={deletingId === r.id}
                  className="flex h-8 items-center gap-1 rounded-full border border-[#C65D38]/40 bg-[#C65D38]/10 px-3 text-[10px] uppercase tracking-[0.1em] text-[#C65D38] hover:bg-[#C65D38] hover:text-[#FAF6EE] disabled:opacity-50"
                >
                  <Trash2 size={11} />
                  {deletingId === r.id ? "…" : "Eliminar"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CountTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "ink" | "terracotta" | "cream"
}) {
  const cls =
    tone === "ink"
      ? "bg-[#1A1612] text-[#FAF6EE]"
      : tone === "terracotta"
        ? "bg-[#C65D38] text-[#FAF6EE]"
        : "bg-[#FFFEFA] border border-[#DDD6C5] text-[#1A1612]"
  return (
    <div className={`rounded-2xl p-3 text-center ${cls}`}>
      <div className="font-display text-2xl">{value}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] opacity-70">
        {label}
      </div>
    </div>
  )
}
