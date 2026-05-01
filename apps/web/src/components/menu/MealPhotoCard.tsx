"use client"

import Link from "next/link"
import { RefreshCw } from "lucide-react"
import { mealLabel } from "@/lib/labels"

const MEAL_EMOJI: Record<string, string> = {
  breakfast: "🥣",
  lunch: "🍲",
  dinner: "🥗",
  snack: "🍎",
}

const MEAL_BG: Record<string, string> = {
  breakfast: "#F2EDE0",
  lunch: "#EFE8D8",
  dinner: "#E8E2D3",
  snack: "#F2EDE0",
}

interface MealPhotoCardProps {
  recipeId?: string
  recipeName?: string
  imageUrl?: string | null
  meal: string
  onRegenerate?: () => void
  isRegenerating?: boolean
}

export function MealPhotoCard({
  recipeId,
  recipeName,
  imageUrl,
  meal,
  onRegenerate,
  isRegenerating,
}: MealPhotoCardProps) {
  if (!recipeId) {
    return (
      <div
        className="flex h-24 items-center justify-center rounded-xl border border-dashed border-[#DDD6C5]"
        style={{ background: MEAL_BG[meal] || "#EFE8D8" }}
      >
        <p className="text-sm text-[#7A7066]">
          {mealLabel(meal)} — sin plato
        </p>
      </div>
    )
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl shadow-md">
      {/* Image or emoji placeholder */}
      <Link href={`/recipes/${recipeId}`}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={recipeName || ""}
            className="h-44 w-full object-cover"
          />
        ) : (
          <div
            className="flex h-44 w-full items-center justify-center"
            style={{ background: MEAL_BG[meal] || "#EFE8D8" }}
          >
            <span className="text-5xl">{MEAL_EMOJI[meal] || "🍽️"}</span>
          </div>
        )}
      </Link>

      {/* Regenerate button */}
      {onRegenerate && (
        <button
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm transition-opacity"
        >
          <RefreshCw
            size={14}
            className={isRegenerating ? "animate-spin text-[#7A7066]" : "text-[#4A4239]"}
          />
        </button>
      )}

      {/* Info overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-3 pt-8">
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/80">
          {mealLabel(meal)}
        </span>
        <p className="text-[15px] font-medium leading-tight text-white">
          {recipeName || "Receta"}
        </p>
      </div>
    </div>
  )
}
