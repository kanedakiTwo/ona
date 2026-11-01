"use client"

import { X } from "lucide-react"
import type { SeasonalProduceCount } from "@ona/shared"

/**
 * «Este mes» (PRO-375, specs/recipes.md): the fruits and vegetables of the
 * month as a row of icons above the grid. Tapping one filters the catalogue
 * by it (`GET /recipes?ingredient=`); the chosen one shows as a chip with ✕
 * next to the title, and tapping it again also takes it off.
 */
export function SeasonalProduceRow({
  produce,
  selected,
  onSelect,
  className = "",
}: {
  produce: SeasonalProduceCount[]
  selected: string
  onSelect: (name: string) => void
  className?: string
}) {
  if (produce.length === 0) return null
  const chosen = produce.find((p) => p.name === selected)
  return (
    <section aria-labelledby="seasonal-produce-title" className={className}>
      <div className="mb-2 flex min-h-9 items-center gap-3">
        <h2 id="seasonal-produce-title" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
          Este mes
        </h2>
        {chosen && (
          <button
            type="button"
            onClick={() => onSelect("")}
            aria-label={`Quitar ${chosen.name}`}
            className="relative flex h-9 items-center gap-1.5 rounded-full border border-ink bg-ink pl-3 pr-2.5 text-[14px] font-medium text-cream before:absolute before:inset-x-0 before:-inset-y-1 active:scale-[0.97]"
          >
            <span aria-hidden="true">{chosen.emoji}</span>
            {chosen.name}
            <X size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        )}
      </div>
      <div role="group" aria-label="Productos del mes" className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible">
        {produce.map((p) => {
          const active = p.name === selected
          return (
            <button
              key={p.name}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(active ? "" : p.name)}
              title={`${p.recipeCount} recetas`}
              className="flex w-[72px] shrink-0 flex-col items-center gap-1 rounded-2xl py-1 active:scale-[0.97]"
            >
              <span
                aria-hidden="true"
                className={`flex h-14 w-14 items-center justify-center rounded-full border text-[28px] leading-none transition-colors ${
                  active ? "border-ink bg-cream-deep" : "border-border bg-paper hover:border-ink"
                }`}
              >
                {p.emoji}
              </span>
              <span className={`line-clamp-2 max-w-full text-center text-[12px] leading-tight text-ink ${active ? "font-semibold" : ""}`}>
                {p.name}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
