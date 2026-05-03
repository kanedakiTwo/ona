"use client"

/**
 * Shared candidate card for the auto-create + re-map modals.
 *
 * Renders a USDA or BEDCA candidate with:
 *   - Spanish description (large, primary)
 *   - English description as fine-print fallback when both languages exist
 *   - per-100 g summary (kcal + protein)
 *   - colored badge by data type:
 *       Foundation → green
 *       SR Legacy  → orange
 *       FNDDS      → tan
 *       BEDCA      → blue
 */

import type { AutoCreateCandidate } from "@/hooks/useIngredients"
import { cn } from "@/lib/utils"

export function CandidateCard({
  candidate,
  picked,
  onClick,
}: {
  candidate: AutoCreateCandidate
  picked: boolean
  onClick: () => void
}) {
  const c = candidate
  const primary = c.descriptionEs ?? c.description
  // Show English fine-print only when:
  //   - we have a Spanish translation that differs from English (USDA),
  //   - and the source is USDA (BEDCA already starts in Spanish so no
  //     redundant English to display).
  const showEnglish =
    c.dataType !== "BEDCA" &&
    c.descriptionEs != null &&
    c.descriptionEs.trim().toLowerCase() !== c.description.trim().toLowerCase()

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border px-4 py-3 text-left transition-all",
        picked
          ? "border-[#1A1612] bg-[#F2EDE0]"
          : "border-[#DDD6C5] bg-[#FAF6EE] hover:border-[#1A1612]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium text-[#1A1612]">
            {primary}
          </div>
          {showEnglish && (
            <div className="mt-0.5 text-[11px] italic text-[#7A7066] truncate">
              {c.description}
            </div>
          )}
          <div className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#7A7066]">
            Por 100 g · {Math.round(c.per100g.kcal)} kcal ·{" "}
            {c.per100g.proteinG.toFixed(1)} g proteína
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]",
            c.dataType === "Foundation" && "bg-[#2D6A4F] text-[#FAF6EE]",
            c.dataType === "SR Legacy" && "bg-[#C65D38] text-[#FAF6EE]",
            c.dataType === "BEDCA" && "bg-[#2A5C8B] text-[#FAF6EE]",
            c.dataType !== "Foundation" &&
              c.dataType !== "SR Legacy" &&
              c.dataType !== "BEDCA" &&
              "bg-[#DDD6C5] text-[#1A1612]",
          )}
        >
          {c.dataType.replace("Survey (FNDDS)", "FNDDS")}
        </span>
      </div>
    </button>
  )
}
