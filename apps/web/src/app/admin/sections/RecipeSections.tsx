"use client"

/**
 * Recipe gap section + regen output section.
 */

import Link from "next/link"
import { Empty } from "./shared"

export function RecipesSection({
  rows,
}: {
  rows: Array<{
    id: string
    name: string
    kcal: number
    missingIngredientIds: string[]
  }>
}) {
  if (rows.length === 0)
    return <Empty>Todas las recetas tienen nutrición calculada.</Empty>
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="rounded-xl border border-border-soft bg-paper p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <Link
              href={`/recipes/${row.id}`}
              className="min-w-0 flex-1 text-[14px] font-medium text-ink truncate hover:text-terracotta-deep"
            >
              {row.name}
            </Link>
            <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-ink-muted">
              {row.kcal === 0 ? "kcal=0" : `kcal=${Math.round(row.kcal)}`}
            </span>
          </div>
          {row.missingIngredientIds.length > 0 && (
            <p className="mt-2 text-[11px] text-ink-muted">
              Bloqueada por {row.missingIngredientIds.length} ingrediente
              {row.missingIngredientIds.length === 1 ? "" : "s"} sin USDA — corrígelos
              en la pestaña «Ingredientes sin USDA».
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

export function RegenSection({
  rows,
}: {
  rows: Array<{
    source: "failed" | "skipped"
    recipeName: string
    errors: Array<{ code?: string; message?: string; path?: string }>
    warnings: Array<{ code?: string; message?: string; path?: string }>
  }>
}) {
  if (rows.length === 0)
    return <Empty>No hay archivos de regen pendientes.</Empty>
  return (
    <ul className="space-y-2">
      {rows.map((row, i) => (
        <li
          key={`${row.recipeName}-${i}`}
          className="rounded-xl border border-border-soft bg-paper p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[14px] font-medium text-ink truncate">
              {row.recipeName}
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                row.source === "failed"
                  ? "bg-terracotta-deep text-cream"
                  : "bg-border text-ink"
              }`}
            >
              {row.source === "failed" ? "fallo" : "skip"}
            </span>
          </div>
          {row.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-ink-mid">
              {row.errors.slice(0, 6).map((e, k) => (
                <li key={k}>
                  <span className="font-mono text-[10px] text-terracotta-deep">
                    {e.code ?? "ERROR"}
                  </span>{" "}
                  {e.message}
                </li>
              ))}
              {row.errors.length > 6 && (
                <li className="italic text-ink-muted">
                  +{row.errors.length - 6} más…
                </li>
              )}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
