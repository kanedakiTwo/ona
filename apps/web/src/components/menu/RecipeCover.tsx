"use client"

/**
 * A recipe's photo, or — when the recipe has none (about a third of the
 * catalogue today) or the image fails to load — a calm bone block with a
 * small food icon for the meal (coffee / pot / apple / soup; until 2026-10-20
 * sunrise / sun / sunset / moon, which read as the time, not the food). Never a grey fork box,
 * and never the dish name again: wherever a cover is shown, the name is
 * already printed next to it.
 *
 * The featured-meal hero doesn't use this for photo-less recipes: it drops
 * the image area altogether (see MealHero in DayMeals.tsx).
 */
import { useState } from "react"
import { Apple, Coffee, CookingPot, Soup } from "lucide-react"

const MEAL_ICON = { breakfast: Coffee, lunch: CookingPot, snack: Apple, dinner: Soup } as const

/** Lucide food icon for a meal key (falls back to the pot). */
export function mealIconFor(meal?: string) {
  return MEAL_ICON[(meal ?? "lunch") as keyof typeof MEAL_ICON] ?? CookingPot
}

interface Props {
  src?: string | null
  name: string
  meal?: string
  className?: string
  loading?: "eager" | "lazy"
}

export function RecipeCover({ src, name, meal, className = "", loading = "lazy" }: Props) {
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
  const Icon = mealIconFor(meal)
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
      <Icon aria-hidden="true" size={22} strokeWidth={1.4} className="relative text-clay" />
    </div>
  )
}
