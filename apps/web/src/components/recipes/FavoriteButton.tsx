"use client"

import { useToggleFavorite } from "@/hooks/useRecipes"
import { Heart } from "lucide-react"
import { cn } from "@/lib/utils"

interface FavoriteButtonProps {
  recipeId: string
  isFavorite: boolean
  userId: string
}

export function FavoriteButton({
  recipeId,
  isFavorite,
  userId,
}: FavoriteButtonProps) {
  const toggleFavorite = useToggleFavorite()

  function handleToggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    toggleFavorite.mutate({ userId, recipeId })
  }

  return (
    <button
      onClick={handleToggle}
      disabled={toggleFavorite.isPending}
      className={cn(
        "rounded-full p-1.5 transition-colors",
        isFavorite
          ? "text-red-500 hover:text-red-600"
          : "text-gray-300 hover:text-red-400"
      )}
      title={isFavorite ? "Quitar de favoritos" : "Anadir a favoritos"}
    >
      <Heart
        size={18}
        className={cn(isFavorite && "fill-current")}
      />
    </button>
  )
}
