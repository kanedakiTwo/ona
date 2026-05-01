"use client"

import Link from "next/link"
import { RefreshCw } from "lucide-react"

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  dinner: "Cena",
  snack: "Snack",
}

const MEAL_EMOJI: Record<string, string> = {
  breakfast: "🥣",
  lunch: "🍲",
  dinner: "🥗",
  snack: "🍎",
}

const MEAL_BG: Record<string, string> = {
  breakfast: "#FAEEDA",
  lunch: "#EAF3DE",
  dinner: "#E6F1FB",
  snack: "#F3E8FF",
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
        className="flex h-24 items-center justify-center rounded-xl border border-dashed border-gray-300"
        style={{ background: MEAL_BG[meal] || "#f5f5f5" }}
      >
        <p className="text-sm text-gray-400">
          {MEAL_LABELS[meal] || meal} — sin plato
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
            style={{ background: MEAL_BG[meal] || "#f5f5f5" }}
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
            className={isRegenerating ? "animate-spin text-gray-500" : "text-gray-600"}
          />
        </button>
      )}

      {/* Info overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-3 pt-8">
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/80">
          {MEAL_LABELS[meal] || meal}
        </span>
        <p className="text-[15px] font-medium leading-tight text-white">
          {recipeName || "Receta"}
        </p>
      </div>
    </div>
  )
}
