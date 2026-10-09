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
 * Both rows (meals and seasons) use the "D · Luz y foto" ink chip of
 * /recipes (PRO-42): paper outline → bone fill + "·" → ink fill + ★. The
 * old forest-green season palette is gone.
 */
import { cn } from "@/lib/utils"

export type FitState = "mid" | "perfect" | undefined

interface Props {
  label: string
  fit: FitState
  onClick: () => void
}

export function FitChip({ label, fit, onClick }: Props) {
  const visualState = fit ?? "none"
  // 36 px visual + a pseudo-element that stretches the hit area to 44 px,
  // like the /recipes filter chips.
  const className = cn(
    "relative inline-flex h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-[14px] transition-colors before:absolute before:inset-x-0 before:-inset-y-1 active:scale-[0.97]",
    visualState === "none" && "border-border bg-paper text-ink-muted hover:border-ink hover:text-ink",
    visualState === "mid" && "border-ink bg-bone text-ink",
    visualState === "perfect" && "border-ink bg-ink font-medium text-cream",
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
