"use client"

import { Clock } from "lucide-react"
import { FavoriteButton } from "@/components/recipes/FavoriteButton"
import { RecipeSourceBadge } from "@/components/recipes/RecipeSourceBadge"
import Link from "next/link"

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  dinner: "Cena",
  snack: "Snack",
}

const SEASON_LABELS: Record<string, string> = {
  spring: "Primavera",
  summer: "Verano",
  autumn: "Otono",
  winter: "Invierno",
}

interface RecipeCardRecipe {
  id: string
  name: string
  authorId?: string | null
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
  onToggleFavorite,
}: RecipeCardProps) {
  return (
    <div className="group relative rounded-xl border border-gray-200 p-4 transition-colors hover:border-gray-300 hover:shadow-sm">
      {/* Favorite button */}
      {userId && (
        <div className="absolute right-3 top-3">
          <FavoriteButton
            recipeId={recipe.id}
            isFavorite={!!isFavorite}
            userId={userId}
          />
        </div>
      )}

      <Link href={`/recipes/${recipe.id}`} className="block">
        <div className="mb-2">
          <RecipeSourceBadge authorId={recipe.authorId} />
        </div>
        <h3 className="pr-8 text-sm font-semibold text-gray-900 group-hover:text-black">
          {recipe.name}
        </h3>

        {recipe.prepTime && (
          <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
            <Clock size={12} />
            <span>{recipe.prepTime} min</span>
          </div>
        )}

        {/* Meal tags */}
        {recipe.meals && recipe.meals.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {recipe.meals.map((meal) => (
              <span
                key={meal}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
              >
                {MEAL_LABELS[meal] ?? meal}
              </span>
            ))}
          </div>
        )}

        {/* Season tags */}
        {recipe.seasons && recipe.seasons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {recipe.seasons.map((season) => (
              <span
                key={season}
                className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
              >
                {SEASON_LABELS[season] ?? season}
              </span>
            ))}
          </div>
        )}
      </Link>
    </div>
  )
}
