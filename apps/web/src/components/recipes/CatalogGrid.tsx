"use client"

import { useSyncExternalStore } from "react"
import { motion } from "motion/react"
import { RecipeCard, type CatalogCardRecipe } from "@/components/recipes/RecipeCard"

const LG_QUERY = "(min-width: 1024px)"

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(LG_QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

/** `lg+` (≥1024 px). `false` on the server, so the first paint is the mobile layout. */
function useIsLg(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(LG_QUERY).matches,
    () => false,
  )
}

type Props = {
  recipes: CatalogCardRecipe[]
  isLoading: boolean
  emptyState: React.ReactNode
  /** Ids rendered below `lg` only (e.g. the second featured recipe, which is a hero at `lg+`). */
  hiddenAtLg?: ReadonlySet<string>
  /** Optional control laid over each card's photo (e.g. "Quitar del recetario" on /cookbooks/[id]). */
  renderAction?: (recipe: CatalogCardRecipe) => React.ReactNode
}

function Item({
  recipe,
  index,
  shape,
  renderAction,
}: {
  recipe: CatalogCardRecipe
  index: number
  shape: "tall" | "short"
  renderAction?: Props["renderAction"]
}) {
  return (
    <motion.li
      className={renderAction ? "relative" : undefined}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
    >
      <RecipeCard recipe={recipe} shape={shape} />
      {renderAction?.(recipe)}
    </motion.li>
  )
}

/**
 * Catalogue grid. Below `lg`: two-column masonry (recipes alternate left /
 * right; the left column starts tall, the right one short, as in the "D"
 * mockup). `lg+`: a plain 4-column grid in catalogue order, 220 px photos.
 */
export default function CatalogGrid({ recipes, isLoading, emptyState, hiddenAtLg, renderAction }: Props) {
  const isLg = useIsLg()

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className={`rounded-[16px] bg-bone animate-pulse lg:aspect-auto lg:h-[220px] ${i % 2 ? "aspect-[4/3]" : "aspect-[7/8]"}`} />
            <div className="h-3 w-3/4 rounded bg-bone animate-pulse" />
          </div>
        ))}
      </div>
    )
  }
  if (recipes.length === 0) return <>{emptyState}</>

  if (isLg) {
    const visible = hiddenAtLg ? recipes.filter((r) => !hiddenAtLg.has(r.id)) : recipes
    return (
      <ul className="grid grid-cols-4 gap-x-5 gap-y-6" data-testid="catalog-grid">
        {visible.map((r, i) => (
          <Item key={r.id} recipe={r} index={i} shape="tall" renderAction={renderAction} />
        ))}
      </ul>
    )
  }

  const left = recipes.filter((_, i) => i % 2 === 0)
  const right = recipes.filter((_, i) => i % 2 === 1)
  return (
    <div className="grid grid-cols-2 items-start gap-3" data-testid="catalog-grid">
      <ul className="flex flex-col gap-4">
        {left.map((r, i) => (
          <Item key={r.id} recipe={r} index={i * 2} shape={i % 2 === 0 ? "tall" : "short"} renderAction={renderAction} />
        ))}
      </ul>
      <ul className="flex flex-col gap-4">
        {right.map((r, i) => (
          <Item key={r.id} recipe={r} index={i * 2 + 1} shape={i % 2 === 0 ? "short" : "tall"} renderAction={renderAction} />
        ))}
      </ul>
    </div>
  )
}
