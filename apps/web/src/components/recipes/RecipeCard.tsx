"use client"

import Link from "next/link"
import { CookingPot, Star } from "lucide-react"
import { isCuratedRecipe, recipeMinutes, type CatalogRecipeLike } from "@ona/shared"

/**
 * Catalogue card for `/recipes` ("D · Luz y foto"): photo with ONLY a time
 * pill bottom-left, Fraunces title below, and the terracotta "Selección
 * Mimoia" seal on system / curated recipes. No season badge (the catalogue
 * never derives a season from the order of `recipe.seasons`) and no
 * ownership badge.
 */

export type CatalogCardRecipe = CatalogRecipeLike & { name: string }

/** Fraunces at UI sizes: semibold, automatic optical size (not the 144 hero cut of `.font-display`). */
export const DISPLAY_UI = "[font-family:var(--font-display)] font-[650] tracking-[-0.01em]"

function SelectionSeal({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Selección Mimoia"
      title="Selección Mimoia"
      data-testid="seleccion-seal"
      className={`flex h-6 w-6 items-center justify-center rounded-full bg-terracotta text-paper shadow-[0_2px_8px_-2px_rgba(26,22,18,0.35)] ${className}`}
    >
      <Star size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
    </span>
  )
}

function TimePill({ minutes, className = "" }: { minutes: number; className?: string }) {
  return (
    <span
      className={`rounded-full bg-paper px-2 py-[3px] text-[12px] font-semibold leading-none text-ink lg:px-[9px] ${className}`}
    >
      {minutes} min
    </span>
  )
}

/**
 * `shape` only matters below `lg`, where the grid is a two-column masonry
 * (tall / short photos alternate). At `lg+` every photo is 220 px tall.
 */
export function RecipeCard({
  recipe,
  shape = "tall",
}: {
  recipe: CatalogCardRecipe
  shape?: "tall" | "short"
}) {
  const minutes = recipeMinutes(recipe)
  const curated = isCuratedRecipe(recipe)

  return (
    <Link
      href={`/recipes/${recipe.id}`}
      data-testid="recipe-card"
      className="group flex flex-col gap-1.5 rounded-[16px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-cream lg:gap-2"
    >
      <span
        className={`relative block overflow-hidden rounded-[16px] bg-bone lg:aspect-auto lg:h-[220px] lg:rounded-[18px] ${
          shape === "tall" ? "aspect-[7/8]" : "aspect-[4/3]"
        }`}
      >
        {recipe.imageUrl ? (
          <img
            src={recipe.imageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:scale-[1.04]"
          />
        ) : (
          // No photo yet: a quiet placeholder instead of a stock photo of another dish.
          <span className="flex h-full w-full items-center justify-center bg-cream-deep text-ink-light">
            <CookingPot size={32} strokeWidth={1.4} aria-hidden="true" />
          </span>
        )}
        {minutes != null && <TimePill minutes={minutes} className="absolute bottom-2 left-2 lg:bottom-2.5 lg:left-2.5" />}
        {curated && <SelectionSeal className="absolute right-2 top-2 lg:right-2.5 lg:top-2.5" />}
      </span>
      <span className={`${DISPLAY_UI} line-clamp-2 text-[17px] leading-[1.2] lg:text-[19px]`}>
        {recipe.name}
      </span>
    </Link>
  )
}
