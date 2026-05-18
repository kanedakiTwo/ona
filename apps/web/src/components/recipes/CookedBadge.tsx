"use client"

/**
 * "Cocinada N veces · última: dd mmm" pill — pulls from the cook_logs
 * stats endpoint (household-scoped). Hides itself when the recipe has
 * never been cooked, so the meta row stays clean for fresh catalog entries.
 *
 * Also exposes a "Cocinada hoy" button that records a cook event for the
 * current user/household. Optimistic by invalidating the relevant queries.
 */
import { ChefHat, History } from "lucide-react"
import { useRecipeCookStats, useRecordCook } from "@/hooks/useCookLogs"

interface Props {
  recipeId: string
  /** Optional context — when this card lives on /menu, we know the menu + slot. */
  menuId?: string | null
  dayIndex?: number | null
  meal?: string | null
  /** Render variant. `pill` = meta-row badge; `button` = standalone CTA. */
  variant?: "pill" | "button"
}

function formatLast(d: string | null): string | null {
  if (!d) return null
  try {
    return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })
  } catch {
    return null
  }
}

export function CookedBadge({ recipeId, menuId, dayIndex, meal, variant = "pill" }: Props) {
  const { data, isLoading } = useRecipeCookStats(recipeId)
  const record = useRecordCook()

  if (variant === "button") {
    // Button variant always renders — even while the stats query is in
    // flight — so the CTA never pops in late on a fresh page load.
    // Count badge fills in once `data` is available. While the request
    // is pending the label is the unadorned "Cocinada" which is also the
    // never-cooked-yet state, so the visual fallback is correct.
    const count = data?.count ?? 0
    const onClick = () =>
      record.mutate({
        recipeId,
        menuId: menuId ?? null,
        dayIndex: dayIndex ?? null,
        meal: meal ?? null,
      })
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={record.isPending}
        className="inline-flex items-center gap-1.5 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-1.5 text-[11px] uppercase tracking-[0.1em] text-[#7A7066] transition-all hover:border-[#2D6A4F] hover:text-[#2D6A4F] disabled:opacity-50"
        aria-label="Marcar como cocinada"
      >
        <ChefHat size={12} />
        {record.isPending ? "Guardando…" : count > 0 ? `Cocinada ${count}×` : "Cocinada"}
      </button>
    )
  }

  // Pill variant — informational, hides while loading + when count is 0.
  if (isLoading || !data) return null
  if (data.count === 0) return null

  const last = formatLast(data.lastCookedAt)
  return (
    <div className="inline-flex items-center gap-1.5 text-[12px] text-[#4A4239]">
      <History size={13} className="text-[#7A7066]" />
      <span>
        Cocinada {data.count}×
        {last && <span className="text-[#7A7066]"> · última {last}</span>}
      </span>
    </div>
  )
}
