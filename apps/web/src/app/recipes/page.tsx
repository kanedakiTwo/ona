"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import {
  detectSeason,
  filterCatalogRecipes,
  pickFeaturedRecipes,
  type CatalogScope,
  type Meal,
  type Season,
} from "@ona/shared"
import { useRecipes } from "@/hooks/useRecipes"
import { useHouseholdCustomTags } from "@/hooks/useRecipeNotes"
import { useAuth } from "@/lib/auth"
import {
  CatalogChips,
  CatalogFiltersSheet,
  CatalogSearch,
  QUICK_MAX_TIME,
} from "@/components/recipes/CatalogFilters"
import CatalogGrid from "@/components/recipes/CatalogGrid"
import { FeaturedRecipeCard } from "@/components/recipes/FeaturedRecipeCard"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"

const SCOPE_KEY = "ona.recipes.scope"

function readScope(): CatalogScope | null {
  try {
    const saved = window.localStorage.getItem(SCOPE_KEY)
    return saved === "all" || saved === "mine" || saved === "ona" ? saved : null
  } catch {
    return null
  }
}

/**
 * `/recipes` — "D · Luz y foto". Header ("Recetas" + Nueva receta), one
 * search field, one chip row (quick filters + scope), a "De temporada" hero
 * when nothing is filtered, then the card grid. Advanced filters live in a
 * dialog opened from the search field (mobile) or "Más filtros" (lg+).
 */
export default function RecipesPage() {
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMeal, setSelectedMeal] = useState<Meal | "">("")
  const [selectedSeason, setSelectedSeason] = useState<Season | "">("")
  const [maxTime, setMaxTime] = useState<number | "">("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  /**
   * Catalogue scope: 'all' (no chip), 'ona' ("Selección Mimoia", system
   * recipes) or 'mine' ("Mis recetas"). Persisted in localStorage.
   */
  const [scope, setScope] = useState<CatalogScope>("all")
  /** Household custom tags (AND filter, server-side). */
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  /** Season "now" — meteorological, Spain; same rule as the menu generator. */
  const [currentSeason] = useState<Season>(() => detectSeason(new Date()))

  useEffect(() => {
    const saved = readScope()
    if (saved) setScope(saved)
  }, [])

  function setScopeAndPersist(next: CatalogScope) {
    setScope(next)
    try {
      window.localStorage.setItem(SCOPE_KEY, next)
    } catch {
      /* private mode: the choice just doesn't survive a reload */
    }
  }
  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }
  const { data: householdTags } = useHouseholdCustomTags()

  const { data: recipes, isLoading } = useRecipes({
    search: searchQuery || undefined,
    meal: selectedMeal || undefined,
    customTags: selectedTags.length > 0 ? selectedTags : undefined,
    perPage: 100,
  })

  // Season / time / scope are filtered client-side (rules in @ona/shared).
  const filteredRecipes = useMemo(
    () =>
      filterCatalogRecipes(recipes ?? [], {
        scope,
        userId: user?.id,
        season: selectedSeason,
        maxTime,
      }),
    [recipes, scope, user?.id, selectedSeason, maxTime],
  )

  const anyFilterActive =
    !!searchQuery || !!selectedMeal || !!selectedSeason || !!maxTime || scope !== "all" || selectedTags.length > 0
  // Filters with no chip in the row → badge on the filters button.
  const hiddenFiltersCount =
    (selectedSeason && selectedSeason !== currentSeason ? 1 : 0) +
    (maxTime && maxTime !== QUICK_MAX_TIME ? 1 : 0) +
    selectedTags.length

  // "De temporada" hero: only on the unfiltered catalogue. Two at lg+ (the
  // second is a regular grid card below lg).
  const featured = useMemo(
    () => (anyFilterActive ? [] : pickFeaturedRecipes(filteredRecipes, { date: new Date(), count: 2 })),
    [anyFilterActive, filteredRecipes],
  )
  const gridRecipes = useMemo(
    () => (featured[0] ? filteredRecipes.filter((r) => r.id !== featured[0].id) : filteredRecipes),
    [featured, filteredRecipes],
  )
  const hiddenAtLg = useMemo(() => new Set(featured[1] ? [featured[1].id] : []), [featured])

  function clearAll() {
    setSelectedMeal("")
    setSelectedSeason("")
    setMaxTime("")
    setSearchQuery("")
    setScopeAndPersist("all")
    setSelectedTags([])
  }

  const openFilters = useCallback(() => setFiltersOpen(true), [])
  const closeFilters = useCallback(() => setFiltersOpen(false), [])

  const filterState = {
    selectedMeal,
    onMealChange: setSelectedMeal,
    selectedSeason,
    onSeasonChange: setSelectedSeason,
    maxTime,
    onMaxTimeChange: setMaxTime,
    scope,
    onScopeChange: setScopeAndPersist,
    householdTags,
    selectedTags,
    onToggleTag: toggleTag,
    currentSeason,
  }

  const count = filteredRecipes.length

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto w-full max-w-[1180px] pb-12 lg:px-12 lg:pb-10 lg:pt-8">
        {/* Row 1 — mobile: title + "+" then the search below; lg: title · search · Nueva receta */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 pt-4 lg:flex-nowrap lg:px-0 lg:pt-0">
          <h1 className={`${DISPLAY_UI} order-1 text-[32px] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]`}>
            Recetas
          </h1>
          <Link
            href="/recipes/new"
            aria-label="Nueva receta"
            className="order-2 ml-auto flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-full bg-ink text-cream transition-colors hover:bg-forest active:scale-95 lg:order-3 lg:h-12 lg:w-auto lg:px-5"
          >
            <Plus size={20} strokeWidth={2.2} aria-hidden="true" />
            <span className="hidden text-[15px] font-semibold lg:inline">Nueva receta</span>
          </Link>
          <CatalogSearch
            className="order-3 basis-full lg:order-2 lg:max-w-[560px] lg:flex-1 lg:basis-auto"
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onOpenFilters={openFilters}
            filtersOpen={filtersOpen}
            hiddenFiltersCount={hiddenFiltersCount}
          />
        </div>

        {/* Row 2 — one chip row (scrolls on mobile, wraps at lg) */}
        <CatalogChips
          className="mt-1.5 lg:mt-[22px]"
          onOpenFilters={openFilters}
          filtersOpen={filtersOpen}
          hiddenFiltersCount={hiddenFiltersCount}
          {...filterState}
        />

        {featured.length > 0 && (
          <section aria-label="De temporada" className="mt-2.5 lg:mt-[22px] lg:grid lg:grid-cols-2 lg:gap-5">
            <FeaturedRecipeCard recipe={featured[0]} />
            {featured[1] && <FeaturedRecipeCard recipe={featured[1]} className="hidden lg:block" />}
          </section>
        )}

        <div className="px-4 pt-3.5 lg:px-0 lg:pt-[22px]">
          {!isLoading && (
            <div className="mb-3 flex items-center justify-between px-1 lg:px-0">
              <p className="text-[12px] text-ink-soft" aria-live="polite">
                {count} {count === 1 ? "receta" : "recetas"}
              </p>
              {anyFilterActive && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="-my-3 py-3 text-[12px] font-medium text-ink underline underline-offset-4"
                >
                  Quitar filtros
                </button>
              )}
            </div>
          )}
          <CatalogGrid
            recipes={gridRecipes}
            isLoading={isLoading}
            hiddenAtLg={hiddenAtLg}
            emptyState={
              count > 0 ? null : (
                <div className="mt-16 text-center">
                  <p className={`${DISPLAY_UI} text-xl text-ink`}>No hay recetas con esos filtros.</p>
                  <p className="mt-2 text-sm text-ink-soft">Prueba a quitarlos o crea una nueva.</p>
                  {anyFilterActive && (
                    <button
                      type="button"
                      onClick={clearAll}
                      className="mt-4 h-11 px-2 text-sm font-medium text-forest underline"
                    >
                      Limpiar filtros
                    </button>
                  )}
                </div>
              )
            }
          />
        </div>
      </div>

      <CatalogFiltersSheet
        open={filtersOpen}
        onClose={closeFilters}
        resultCount={count}
        anyFilterActive={anyFilterActive}
        onClearAll={clearAll}
        {...filterState}
      />
    </div>
  )
}
