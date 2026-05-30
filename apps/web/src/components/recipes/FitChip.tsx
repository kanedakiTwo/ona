"use client"

/**
 * Three-state fit chip — used by /recipes/new and /recipes/[id]/edit to
 * tag a recipe's affinity with each meal (desayuno / comida / cena /
 * snack) and each season. Visual progression on tap:
 *
 *   1. outline only        → unmarked (the matcher excludes this slot)
 *   2. soft fill           → 'mid' (encaja a veces; pool weight 1×)
 *   3. solid fill + ★      → 'perfect' (encaja perfecto; pool weight 3×)
 *   4. back to outline
 *
 * The two palettes mirror the existing edit-form colour split: ink (#1A1612)
 * for meals — matches the active tab bar / submit button — and forest
 * (#2D6A4F) for seasons, the green that already runs through the produce
 * + cooking-mode accent surfaces.
 */
import { cn } from "@/lib/utils"

export type FitState = "mid" | "perfect" | undefined

interface Props {
  label: string
  fit: FitState
  onClick: () => void
  palette: "ink" | "forest"
}

export function FitChip({ label, fit, onClick, palette }: Props) {
  const accent = palette === "ink" ? "#1A1612" : "#2D6A4F"
  const softFill = palette === "ink" ? "#E9E2D3" : "#CAE5D5"
  const visualState = fit ?? "none"
  const className = cn(
    "rounded-full border px-4 py-2 text-[12px] uppercase tracking-[0.12em] transition-all active:scale-95",
    visualState === "none" &&
      "border-[#DDD6C5] bg-transparent text-[#A39A8E] hover:border-[#1A1612] hover:text-[#1A1612]",
    visualState === "mid" && "text-[#1A1612]",
    visualState === "perfect" && "text-[#FAF6EE]",
  )
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={visualState !== "none"}
      title={
        visualState === "none"
          ? "No marcada — no aparece"
          : visualState === "mid"
            ? "Encaja a veces — peso 1×"
            : "Encaja perfecto — peso 3×"
      }
      className={className}
      style={
        visualState === "mid"
          ? { borderColor: accent, backgroundColor: softFill }
          : visualState === "perfect"
            ? { borderColor: accent, backgroundColor: accent }
            : undefined
      }
    >
      {label}
      {visualState === "mid" && <span className="ml-1 opacity-60">·</span>}
      {visualState === "perfect" && <span className="ml-1">★</span>}
    </button>
  )
}

/**
 * Three-state cycle: none → mid → perfect → none. Pure helper; the
 * caller passes the current map + setter and the key to toggle.
 */
export function cycleFit<K extends string>(
  map: Partial<Record<K, "mid" | "perfect">>,
  setMap: (next: Partial<Record<K, "mid" | "perfect">>) => void,
  key: K,
) {
  const current = map[key]
  const next: "mid" | "perfect" | undefined =
    current === undefined ? "mid" : current === "mid" ? "perfect" : undefined
  const updated = { ...map }
  if (next === undefined) {
    delete updated[key]
  } else {
    updated[key] = next
  }
  setMap(updated)
}
