"use client"

import Link from "next/link"
import { recipeMinutes } from "@ona/shared"
import { DISPLAY_UI, type CatalogCardRecipe } from "@/components/recipes/RecipeCard"

/**
 * "De temporada" hero on `/recipes` (only when no search / filter is on).
 * Mobile: full-bleed 220 px photo. `lg+`: 290 px rounded card (two side by
 * side). A paper caption card overlaps the bottom-left corner. The eyebrow is
 * always "De temporada · <time>", which is true by construction:
 * `pickFeaturedRecipes` only returns in-season recipes with a photo.
 */
export function FeaturedRecipeCard({
  recipe,
  className = "",
}: {
  recipe: CatalogCardRecipe
  className?: string
}) {
  const minutes = recipeMinutes(recipe)
  const eyebrow = minutes != null ? `De temporada · ${minutes} min` : "De temporada"

  return (
    <Link
      href={`/recipes/${recipe.id}`}
      data-testid="featured-recipe"
      className={`group relative block h-[220px] overflow-hidden bg-bone text-ink outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink lg:h-[290px] lg:rounded-[22px] ${className}`}
    >
      <img
        src={recipe.imageUrl ?? ""}
        alt=""
        className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:scale-[1.03]"
      />
      <span className="absolute bottom-3.5 left-4 flex max-w-[calc(100%-2rem)] flex-col gap-px rounded-[16px] bg-paper px-3.5 py-2.5 lg:bottom-[18px] lg:left-[18px] lg:gap-0.5 lg:px-4 lg:py-3">
        {/* #B5432A: terracotta darkened for small text on paper (5.5:1, AA); the #C65D38 token is 4.1:1. */}
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#B5432A]">
          {eyebrow}
        </span>
        <span className={`${DISPLAY_UI} line-clamp-2 text-[21px] leading-[1.15] lg:text-[24px]`}>
          {recipe.name}
        </span>
      </span>
    </Link>
  )
}
