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
  /**
   * Replaces the default compact shape (catalog card). The recipe detail
   * passes its own 44/50 px circle. Colour classes are still applied.
   */
  className?: string
  /** `ink`: ink outline / terracotta fill (editorial detail); default: grey / red. */
  tone?: "default" | "ink"
}

export function FavoriteButton({
  recipeId,
  isFavorite,
  userId,
  className,
  tone = "default",
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

  const label = isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"
  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={toggleFavorite.isPending}
      className={cn(
        className ?? "relative rounded-full p-1.5 transition-colors",
        tone === "ink"
          ? isFavorite
            ? "text-[#C65D38] hover:text-[#A84B2C]"
            : "text-[#1A1612] hover:text-[#C65D38]"
          : isFavorite
            ? "text-red-500 hover:text-red-600"
            : "text-gray-300 hover:text-red-400"
      )}
      title={label}
      aria-label={label}
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
