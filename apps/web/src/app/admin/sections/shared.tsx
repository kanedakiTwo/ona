"use client"

import type { ReactNode } from "react"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border-soft bg-transparent p-6 text-center text-[12px] italic text-ink-muted">
      {children}
    </div>
  )
}

export function Tile({
  label,
  value,
  tone,
  onClick,
}: {
  label: string
  value: number
  tone: "ink" | "terracotta" | "cream"
  onClick: () => void
}) {
  const styles =
    tone === "ink"
      ? "bg-ink text-cream border-ink"
      : tone === "terracotta"
      ? "bg-terracotta-deep text-cream border-terracotta-deep"
      : "bg-paper text-ink border-border-soft"
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition-all active:scale-[0.98] ${styles}`}
    >
      <div className={`${DISPLAY_UI} text-[2rem] leading-none`}>{value}</div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.15em] opacity-80">
        {label}
      </div>
    </button>
  )
}
