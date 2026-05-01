"use client"

import { Clock } from "lucide-react"
import { FavoriteButton } from "@/components/recipes/FavoriteButton"
import Link from "next/link"

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

interface RecipeCardRecipe {
  id: string
  name: string
  authorId?: string | null
  imageUrl?: string | null
  prepTime?: number
  meals?: string[]
  seasons?: string[]
  tags?: string[]
  is_favorite?: boolean
}

interface RecipeCardProps {
  recipe: RecipeCardRecipe
  isFavorite?: boolean
  userId?: string
  onToggleFavorite?: () => void
}

export function RecipeCard({
  recipe,
  isFavorite,
  userId,
}: RecipeCardProps) {
  const mainMeal = recipe.meals?.[0] || "lunch"

  return (
    <div className="group relative overflow-hidden rounded-xl bg-white shadow-sm">
      {/* Favorite button */}
      {userId && (
        <div className="absolute right-2 top-2 z-10">
          <FavoriteButton
            recipeId={recipe.id}
            isFavorite={!!isFavorite}
            userId={userId}
          />
        </div>
      )}

      <Link href={`/recipes/${recipe.id}`} className="block">
        {/* Image */}
        {recipe.imageUrl ? (
          <img
            src={recipe.imageUrl}
            alt={recipe.name}
            className="h-32 w-full object-cover"
          />
        ) : (
          <div
            className="flex h-32 w-full items-center justify-center"
            style={{ background: MEAL_BG[mainMeal] || "#f5f5f5" }}
          >
            <span className="text-4xl">{MEAL_EMOJI[mainMeal] || "🍽️"}</span>
          </div>
        )}

        {/* Info */}
        <div className="p-3">
          <h3 className="text-[13px] font-semibold leading-tight text-[#1A1A1A]">
            {recipe.name}
          </h3>

          <div className="mt-1.5 flex items-center gap-2">
            {recipe.prepTime ? (
              <span className="flex items-center gap-1 text-[11px] text-[#999999]">
                <Clock size={10} />
                {recipe.prepTime} min
              </span>
            ) : null}
            {recipe.meals && recipe.meals.length > 0 && (
              <span className="text-[11px] text-[#999999]">
                {MEAL_LABELS[recipe.meals[0]] ?? recipe.meals[0]}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  )
}
