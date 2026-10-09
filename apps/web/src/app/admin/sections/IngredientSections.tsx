"use client"

/**
 * Ingredient gap sections — fdcId, aisle, density, unitWeight, allergens.
 *
 * Each component takes a pre-fetched rows array and wires its own mutation
 * (PATCH /ingredients/:id). The fdcId section delegates the modal to the
 * parent so the picker UX is centralized.
 */

import { useState } from "react"
import { aisleLabel, AISLE_ORDER } from "@/lib/labels"
import { usePatchIngredient } from "@/hooks/useAdmin"
import { Empty } from "./shared"

export function FdcSection({
  rows,
  onRemap,
}: {
  rows: Array<{ id: string; name: string; aisle: string | null; allergenTags: string[] | null }>
  onRemap: (row: { id: string; name: string }) => void
}) {
  if (rows.length === 0) return <Empty>Todos los ingredientes tienen USDA mapeado.</Empty>
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-border-soft bg-paper p-3"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-ink truncate">
              {row.name}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-ink-muted">
              {aisleLabel(row.aisle)}
              {row.allergenTags && row.allergenTags.length > 0 && (
                <span className="ml-2 normal-case tracking-normal">
                  · {row.allergenTags.join(", ")}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => onRemap({ id: row.id, name: row.name })}
            className="shrink-0 rounded-full bg-ink px-3.5 py-1.5 text-[11px] uppercase tracking-[0.12em] text-cream active:scale-95"
          >
            Mapear
          </button>
        </li>
      ))}
    </ul>
  )
}

export function AisleSection({
  rows,
}: {
  rows: Array<{ id: string; name: string }>
}) {
  const patch = usePatchIngredient()
  if (rows.length === 0) return <Empty>Ningún ingrediente en «otros».</Empty>
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-border-soft bg-paper p-3"
        >
          <div className="min-w-0 flex-1 text-[14px] font-medium text-ink truncate">
            {row.name}
          </div>
          <select
            disabled={patch.isPending}
            defaultValue="otros"
            onChange={(e) => {
              const aisle = e.target.value as (typeof AISLE_ORDER)[number]
              patch.mutate({ id: row.id, body: { aisle } })
            }}
            className="shrink-0 rounded-lg border border-border bg-cream-deep px-2 py-1.5 text-[12px] text-ink focus:outline-none focus:ring-1 focus:ring-ink"
          >
            {AISLE_ORDER.map((a) => (
              <option key={a} value={a}>
                {aisleLabel(a)}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  )
}

export function DensitySection({
  rows,
}: {
  rows: Array<{ id: string; name: string; aisle: string | null }>
}) {
  return <NumericRows rows={rows} field="density" placeholder="g/ml" />
}

export function UnitWeightSection({
  rows,
}: {
  rows: Array<{ id: string; name: string; aisle: string | null }>
}) {
  return <NumericRows rows={rows} field="unitWeight" placeholder="g/u" />
}

function NumericRows({
  rows,
  field,
  placeholder,
}: {
  rows: Array<{ id: string; name: string; aisle: string | null }>
  field: "density" | "unitWeight"
  placeholder: string
}) {
  const patch = usePatchIngredient()
  const [draft, setDraft] = useState<Record<string, string>>({})
  if (rows.length === 0) return <Empty>Sin huecos pendientes.</Empty>

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const value = draft[row.id] ?? ""
        return (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border-soft bg-paper p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-ink truncate">
                {row.name}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                {aisleLabel(row.aisle)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min={0}
                value={value}
                placeholder={placeholder}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [row.id]: e.target.value }))
                }
                className="w-24 shrink-0 rounded-lg border border-border bg-cream-deep px-2 py-1.5 text-[12px] text-ink focus:outline-none focus:ring-1 focus:ring-ink"
              />
              <button
                disabled={!value || patch.isPending}
                onClick={() => {
                  const num = Number(value)
                  if (!Number.isFinite(num) || num <= 0) return
                  patch.mutate({
                    id: row.id,
                    body: { [field]: num } as never,
                  })
                  setDraft((d) => {
                    const { [row.id]: _, ...rest } = d
                    return rest
                  })
                }}
                className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-cream active:scale-95 disabled:opacity-40"
              >
                Guardar
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function AllergenSection({
  rows,
}: {
  rows: Array<{
    id: string
    name: string
    currentTags: string[]
    suggestedTags: string[]
  }>
}) {
  const patch = usePatchIngredient()
  if (rows.length === 0) return <Empty>Los alérgenos están al día.</Empty>
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="rounded-xl border border-border-soft bg-paper p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-ink truncate">
                {row.name}
              </div>
            </div>
            <button
              disabled={patch.isPending}
              onClick={() =>
                patch.mutate({
                  id: row.id,
                  body: { allergenTags: row.suggestedTags },
                })
              }
              className="shrink-0 rounded-full bg-ink hover:bg-ink-mid px-3.5 py-1.5 text-[11px] uppercase tracking-[0.12em] text-cream active:scale-95 disabled:opacity-40"
            >
              Aceptar
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                Actual
              </div>
              <div className="mt-1 text-ink-mid">
                {row.currentTags.length > 0 ? row.currentTags.join(", ") : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-terracotta-deep">
                Sugerido
              </div>
              <div className="mt-1 text-ink">
                {row.suggestedTags.join(", ")}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
