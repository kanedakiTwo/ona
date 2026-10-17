"use client"

/**
 * CatalogWishesSection — «Deseos del catálogo» (PRO-154,
 * specs/catalog-import.md): dishes households want that the catalogue
 * doesn't have yet, most-asked first. Same list Cocina reads with the
 * metrics token. No names: only the dish, where it came from and how many
 * households ask for it.
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface CatalogWishItem {
  id: string
  dish: string
  households: number
  sources: string[]
  status: "abierto" | "cubierto" | "descartado"
  recipeId: string | null
  updatedAt: string
}

const SOURCE_LABEL: Record<string, string> = {
  alta: "favoritos del alta",
  me_encanta: "«Me encanta»",
  mimo: "petición a Mimo",
  evaluador: "menú sin acierto",
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "abierto", label: "Pendientes" },
  { key: "cubierto", label: "Ya cubiertos" },
  { key: "todos", label: "Todos" },
]

export function CatalogWishesSection() {
  const [status, setStatus] = useState("abierto")
  const q = useQuery({
    queryKey: ["admin", "catalog-wishes", status],
    queryFn: () => api.get<{ count: number; items: CatalogWishItem[] }>(`/admin/catalog-wishes?status=${status}`),
  })
  return (
    <section data-testid="catalog-wishes-section" className="space-y-4">
      <p className="max-w-md text-[13px] text-ink-muted">
        Platos que algún hogar quiere y no tenemos en el catálogo. Cuando se publica una receta que lo cubre, pasa a «Ya cubiertos».
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatus(f.key)}
            aria-pressed={status === f.key}
            className={`min-h-[44px] rounded-full border px-4 ${status === f.key ? "border-ink bg-ink text-cream" : "border-border bg-paper text-ink"}`}
          >
            {f.label}
          </button>
        ))}
        {q.data && <span className="ml-1">{q.data.count} platos</span>}
      </div>
      {q.isLoading && <p className="text-eyebrow">Cargando…</p>}
      {q.data?.count === 0 && <p className="text-[14px] text-ink-muted">No hay ningún plato en esta lista.</p>}
      <ul className="space-y-2">
        {(q.data?.items ?? []).map((w) => (
          <li key={w.id} data-testid="catalog-wish" className="flex items-start justify-between gap-3 rounded-2xl border border-border-soft bg-paper p-4">
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-ink first-letter:uppercase">{w.dish}</p>
              <p className="mt-1 text-[12px] text-ink-muted">
                {w.sources.map((s) => SOURCE_LABEL[s] ?? s).join(" · ")}
                {w.status === "cubierto" && w.recipeId ? (
                  <>
                    {" · "}
                    <a className="underline" href={`/recipes/${w.recipeId}`}>ver la receta</a>
                  </>
                ) : null}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[20px] font-semibold leading-none text-ink">{w.households}</div>
              <div className="text-[11px] text-ink-muted">{w.households === 1 ? "hogar" : "hogares"}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
