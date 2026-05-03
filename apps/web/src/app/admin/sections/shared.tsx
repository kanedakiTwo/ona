"use client"

import type { ReactNode } from "react"

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[#DDD6C5] bg-transparent p-6 text-center text-[12px] italic text-[#7A7066]">
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
      ? "bg-[#1A1612] text-[#FAF6EE] border-[#1A1612]"
      : tone === "terracotta"
      ? "bg-[#C65D38] text-[#FAF6EE] border-[#C65D38]"
      : "bg-[#FFFEFA] text-[#1A1612] border-[#DDD6C5]"
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition-all active:scale-[0.98] ${styles}`}
    >
      <div className="font-display text-[2rem] leading-none">{value}</div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.15em] opacity-80">
        {label}
      </div>
    </button>
  )
}
