"use client"

import { useToggleFavorite } from "@/hooks/useRecipes"
import { useOnlineStatus } from "@/lib/pwa/useOnlineStatus"
import { haptic } from "@/lib/pwa/haptics"
import { Clock, Heart } from "lucide-react"
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
  const { pendingResourceIds } = useOnlineStatus()
  const isPending = pendingResourceIds.has(recipeId)

  function handleToggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    haptic.medium()
    toggleFavorite.mutate({ userId, recipeId })
  }

  return (
    <button
      onClick={handleToggle}
      disabled={toggleFavorite.isPending}
      className={cn(
        "relative rounded-full p-1.5 transition-colors",
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
      {isPending && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-white text-ink-soft shadow-sm"
          aria-label="Pendiente de sincronizar"
        >
          <Clock size={10} />
        </span>
      )}
    </button>
  )
}
