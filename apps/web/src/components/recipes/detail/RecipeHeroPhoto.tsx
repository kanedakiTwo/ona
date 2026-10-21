"use client"

import { motion } from "motion/react"
import { CookingPot } from "lucide-react"

/**
 * The photo slot of `/recipes/<id>` (mobile hero and desktop sticky photo).
 * It fills its parent, which sets the size and the rounding. Without a photo
 * (`src` null, or the image failed to load) it shows the same quiet
 * placeholder as the catalogue card (`RecipeCard`): `cream-deep` with a pot —
 * never a stock photo of another dish, which reads as this recipe's photo.
 */
export function RecipeHeroPhoto({
  src,
  alt,
  initialScale,
  onError,
}: {
  src: string | null
  alt: string
  initialScale: number
  onError?: () => void
}) {
  if (!src) {
    return (
      <div
        data-testid="recipe-photo-placeholder"
        role="img"
        aria-label={`${alt}, sin foto`}
        className="flex h-full w-full items-center justify-center bg-cream-deep text-ink-light"
      >
        <CookingPot size={56} strokeWidth={1.2} aria-hidden="true" />
      </div>
    )
  }
  return (
    <motion.img
      initial={{ scale: initialScale }}
      animate={{ scale: 1 }}
      transition={{ duration: 1.2, ease: [0.19, 1, 0.22, 1] }}
      src={src}
      alt={alt}
      onError={onError}
      className="h-full w-full object-cover"
    />
  )
}
