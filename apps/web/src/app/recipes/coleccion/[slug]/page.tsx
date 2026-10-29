"use client"

/**
 * `/recipes/coleccion/<slug>` — one of Cocina's collections (PRO-374,
 * specs/recipes.md → «Colecciones»): back to Recetas, title, subtitle and
 * count, then its recipes in Cocina's order with the `/recipes` card
 * (`CatalogGrid`). Open without an account (public chrome signed out, see
 * lib/routeAccess.ts); signed out it ends with the waitlist block, like the
 * catalogue.
 */
import Link from "next/link"
import { useParams } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { useCatalogCollection } from "@/hooks/useCatalogCollections"
import CatalogGrid from "@/components/recipes/CatalogGrid"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"
import { CatalogueWaitlistCta } from "@/components/recipes/RecipeWaitlistCta"

export default function CollectionPage() {
  const params = useParams<{ slug: string }>()
  const slug = String(params?.slug ?? "")
  const { user } = useAuth()
  const signedOut = !user
  const { data, isLoading, isError } = useCatalogCollection(slug)
  const count = data?.recipes.length ?? 0

  return (
    <div className={signedOut ? "bg-cream pb-20 md:pb-28" : "min-h-screen bg-cream"}>
      <div
        className={
          signedOut ? "public-container" : "mx-auto w-full max-w-[var(--page-max)] pb-24 lg:px-12 lg:pb-10 lg:pt-8"
        }
      >
        <header className={signedOut ? "pb-6 pt-28 md:pb-8 md:pt-36" : "px-5 pb-5 pt-3 lg:px-0 lg:pb-8"}>
          <Link
            href="/recipes"
            className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-terracotta-deep"
          >
            <ChevronLeft size={16} /> Recetas
          </Link>
          {data && (
            <>
              <div className="text-eyebrow mt-3">Colección</div>
              <h1 className={`${DISPLAY_UI} mt-1 text-[32px] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]`}>
                {data.collection.title}
              </h1>
              {data.collection.subtitle && (
                <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-soft">{data.collection.subtitle}</p>
              )}
              <p className="mt-2 text-[12px] text-ink-soft">
                {count} {count === 1 ? "receta" : "recetas"}
              </p>
            </>
          )}
        </header>

        {isError ? (
          <div className="mt-10 text-center">
            <p className={`${DISPLAY_UI} text-xl text-ink`}>Esta colección ya no está.</p>
            <Link href="/recipes" className="mt-4 inline-block h-11 px-2 text-sm font-medium text-forest underline">
              Ver todas las recetas
            </Link>
          </div>
        ) : (
          <div className={signedOut ? "" : "px-4 lg:px-0"}>
            <CatalogGrid recipes={data?.recipes ?? []} isLoading={isLoading} emptyState={null} />
          </div>
        )}

        {signedOut && <CatalogueWaitlistCta className="mt-16 md:mt-24" />}
      </div>
    </div>
  )
}
