"use client"

/**
 * A recipe's photo, or — when the recipe has none (about a third of the
 * catalogue today) — an editorial "cover": a bone block with the dish name
 * set in Fraunces italic (large surfaces) or the meal's icon (thumbnails).
 * Never a grey fork box. The fallback also kicks in when the image fails
 * to load.
 */
import { useState } from "react"
import { Moon, Sun, Sunrise, Sunset } from "lucide-react"

const MEAL_ICON = { breakfast: Sunrise, lunch: Sun, snack: Sunset, dinner: Moon } as const

interface Props {
  src?: string | null
  name: string
  meal?: string
  /** `cover` = big surfaces (hero, desktop cards): name in Fraunces. `thumb` = small tiles: meal icon. */
  variant?: "cover" | "thumb"
  className?: string
  /** Extra classes for the fallback's name text (size). */
  nameClassName?: string
  loading?: "eager" | "lazy"
}

export function RecipeCover({
  src,
  name,
  meal,
  variant = "thumb",
  className = "",
  nameClassName = "text-[1.9rem]",
  loading = "lazy",
}: Props) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        loading={loading}
        onError={() => setFailed(true)}
        className={`object-cover ${className}`}
      />
    )
  }
  const Icon = MEAL_ICON[(meal ?? "lunch") as keyof typeof MEAL_ICON] ?? Sun
  return (
    <div
      role="img"
      aria-label={name}
      className={`relative flex items-center justify-center overflow-hidden bg-bone ${className}`}
    >
      {/* Soft paper vignette so the block reads as a printed page, not an empty box. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_30%_20%,rgba(255,254,250,0.75),transparent_60%)]"
      />
      {variant === "cover" ? (
        <div aria-hidden="true" className="relative flex max-w-[85%] flex-col items-center gap-3 text-center">
          <Icon size={22} strokeWidth={1.4} className="text-clay" />
          <span className={`font-serif-text italic leading-[1.05] text-ink-mid ${nameClassName}`}>{name}</span>
        </div>
      ) : (
        <Icon aria-hidden="true" size={22} strokeWidth={1.4} className="relative text-clay" />
      )}
    </div>
  )
}
