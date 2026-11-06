"use client"

import Link from "next/link"
import { CATALOG_COLLECTION_PATH, type CatalogCollectionCard } from "@ona/shared"
import { useCatalogCollections } from "@/hooks/useCatalogCollections"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"

/**
 * «Colecciones» on `/recipes` (PRO-374, specs/recipes.md → «Colecciones»):
 * Cocina's editorial collections as a row of cards (photo of the first
 * recipe, title, how many recipes) that scrolls sideways on mobile. Nothing
 * when there are none. Same for everyone, with or without an account.
 */
export function CollectionsRow({ className = "", edgeClassName = "" }: { className?: string; edgeClassName?: string }) {
  const { data: collections } = useCatalogCollections()
  if (!collections || collections.length === 0) return null
  return (
    <section aria-labelledby="colecciones-title" className={className} data-testid="collections-row">
      <h2 id="colecciones-title" className={`${DISPLAY_UI} text-[20px] leading-tight text-ink lg:text-[24px] ${edgeClassName}`}>
        Colecciones
      </h2>
      <ul className={`mt-3 flex snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:none] lg:gap-4 ${edgeClassName}`}>
        {collections.map((c) => (
          <li key={c.slug} className="w-[180px] shrink-0 snap-start lg:w-[220px]">
            <CollectionCard collection={c} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function CollectionCard({ collection: c }: { collection: CatalogCollectionCard }) {
  return (
    <Link
      href={`${CATALOG_COLLECTION_PATH}/${c.slug}`}
      data-testid="collection-card"
      className="group block overflow-hidden rounded-[18px] bg-paper text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      <div className="h-[120px] overflow-hidden bg-bone lg:h-[140px]">
        {c.imageUrl && (
          <img
            src={c.imageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:scale-[1.03]"
          />
        )}
      </div>
      <div className="px-3.5 py-3">
        <p className={`${DISPLAY_UI} line-clamp-2 text-[17px] leading-[1.15]`}>{c.title}</p>
        <p className="mt-1 text-[12px] text-ink-soft">
          {c.recipeCount} {c.recipeCount === 1 ? "receta" : "recetas"}
        </p>
      </div>
    </Link>
  )
}
