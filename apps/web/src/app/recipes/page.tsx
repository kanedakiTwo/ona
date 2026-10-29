"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import {
  BRAND_NAME,
  detectSeason,
  filterCatalogRecipes,
  pickFeaturedRecipes,
  type CatalogScope,
  type Meal,
  type Season,
} from "@ona/shared"
import { useRecipes, useRecipesWithWhatIHave, useSeasonalProduce } from "@/hooks/useRecipes"
import { useHouseholdCustomTags } from "@/hooks/useRecipeNotes"
import { useAuth } from "@/lib/auth"
import {
  CatalogChips,
  CatalogFiltersSheet,
  CatalogSearch,
  QUICK_MAX_TIME,
} from "@/components/recipes/CatalogFilters"
import CatalogGrid from "@/components/recipes/CatalogGrid"
import { WithWhatIHavePicker, MAX_WITH_WHAT_I_HAVE, type PickedIngredient } from "@/components/recipes/WithWhatIHavePicker"
import { FeaturedRecipeCard } from "@/components/recipes/FeaturedRecipeCard"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"
import { CatalogueWaitlistCta } from "@/components/recipes/RecipeWaitlistCta"
import { SeasonalProduceRow } from "@/components/recipes/SeasonalProduceRow"

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
 * search field, one chip row (quick filters + scope, plus «Con lo que tengo»,
 * which opens an ingredient picker and swaps the grid for ranked results
 * with what is missing), the «Este mes» row of the month's fruits and
 * vegetables (PRO-375: one tapped filters by that ingredient), a "De temporada" hero
 * when nothing is filtered, then the card grid. Advanced filters live in a
 * dialog opened from the search field (mobile) or "Más filtros" (lg+).
 *
 * Signed out (specs/recipes.md → "Catálogo público") this is the public
 * catalogue: RootShell draws PublicNavbar + Footer around it, the content sits
 * on the public grid (`public-container`) under an editorial header, only the
 * generic browsing filters are left (search, De temporada, En 30 min, meals,
 * Más filtros without "Recetas"/tags) and it ends with the waitlist block.
 * Nothing that needs an account: no «Nueva receta», «Mis recetas», «Selección
 * Mimoia» (everything shown is Mimoia's) or «Con lo que tengo».
 */
export default function RecipesPage() {
  const { user } = useAuth()
  // RootShell only renders this page once the session has resolved.
  const signedOut = !user
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMeal, setSelectedMeal] = useState<Meal | "">("")
  const [selectedSeason, setSelectedSeason] = useState<Season | "">("")
  const [maxTime, setMaxTime] = useState<number | "">("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  /**
   * Catalogue scope: 'all' (no chip), 'ona' ("Selección Mimoia", system
   * recipes) or 'mine' ("Mis recetas"). Persisted in localStorage.
   */
  const [savedScope, setScope] = useState<CatalogScope>("all")
  const scope: CatalogScope = signedOut ? "all" : savedScope
  /** Household custom tags (AND filter, server-side). */
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  /** «Con lo que tengo» (PRO-31): on/off + the 1–3 ingredients picked. */
  const [withWhatIHave, setWithWhatIHave] = useState(false)
  const [picked, setPicked] = useState<PickedIngredient[]>([])
  /** Season "now" — meteorological, Spain; same rule as the menu generator. */
  const [currentSeason] = useState<Season>(() => detectSeason(new Date()))
  /** «Este mes» (PRO-375): the browser's month and the product picked from the row. */
  const [currentMonth] = useState(() => new Date().getMonth() + 1)
  const [produce, setProduce] = useState("")
  const { data: seasonalProduce } = useSeasonalProduce(currentMonth)

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
  const { data: householdTags } = useHouseholdCustomTags({ enabled: !signedOut })

  const { data: catalogRecipes, isLoading: catalogLoading } = useRecipes({
    search: searchQuery || undefined,
    meal: selectedMeal || undefined,
    customTags: selectedTags.length > 0 ? selectedTags : undefined,
    ingredient: produce || undefined,
    perPage: 100,
    // PRO-299: «Mis recetas» asks the API for them, so none is cut off.
    ...(scope === "mine" ? { mine: true } : {}),
  })
  const pickedIds = useMemo(() => picked.map((p) => p.id), [picked])
  const { data: withWhatIHaveRecipes, isLoading: withWhatIHaveLoading } = useRecipesWithWhatIHave(
    withWhatIHave ? pickedIds : [],
  )
  // «Con lo que tengo» results come ranked from the server; search and meal
  // (server-side on the plain catalogue) are applied here instead.
  const recipes = useMemo(() => {
    if (!withWhatIHave) return catalogRecipes
    const q = searchQuery.trim().toLowerCase()
    return (withWhatIHaveRecipes ?? []).filter(
      (r) =>
        (!q || r.name.toLowerCase().includes(q)) &&
        (!selectedMeal || (r.meals ?? []).includes(selectedMeal)),
    )
  }, [withWhatIHave, catalogRecipes, withWhatIHaveRecipes, searchQuery, selectedMeal])
  const isLoading = withWhatIHave ? picked.length > 0 && withWhatIHaveLoading : catalogLoading
  const waitingForIngredients = withWhatIHave && picked.length === 0

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
    !!searchQuery ||
    !!selectedMeal ||
    !!selectedSeason ||
    !!maxTime ||
    scope !== "all" ||
    selectedTags.length > 0 ||
    withWhatIHave ||
    !!produce
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
    setWithWhatIHave(false)
    setPicked([])
    setProduce("")
  }

  function addPicked(ing: PickedIngredient) {
    setPicked((prev) =>
      prev.some((p) => p.id === ing.id) || prev.length >= MAX_WITH_WHAT_I_HAVE ? prev : [...prev, ing],
    )
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
    householdTags: signedOut ? undefined : householdTags,
    selectedTags,
    onToggleTag: toggleTag,
    currentSeason,
    withWhatIHave,
    onWithWhatIHaveChange: signedOut
      ? undefined
      : (on: boolean) => {
          setWithWhatIHave(on)
          if (on) setProduce("")
        },
    accountFilters: !signedOut,
  }

  const count = filteredRecipes.length

  const search = (
    <CatalogSearch
      className={
        signedOut
          ? "lg:max-w-[560px]"
          : "order-3 basis-full lg:order-2 lg:max-w-[560px] lg:flex-1 lg:basis-auto"
      }
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onOpenFilters={openFilters}
      filtersOpen={filtersOpen}
      hiddenFiltersCount={hiddenFiltersCount}
    />
  )

  return (
    <div className={signedOut ? "bg-cream pb-20 md:pb-28" : "min-h-screen bg-cream"}>
      <div
        className={
          signedOut ? "public-container" : "mx-auto w-full max-w-[var(--page-max)] pb-12 lg:px-12 lg:pb-10 lg:pt-8"
        }
      >
        {signedOut ? (
          <>
            {/* Public catalogue: editorial header on the public grid, then the search. */}
            <header className="pb-8 pt-28 md:pb-10 md:pt-36">
              <div className="text-eyebrow mb-6">Catálogo {BRAND_NAME}</div>
              <h1 className="text-editorial-xl">
                Recetas con <span className="font-italic italic text-[#C65D38]">criterio</span>.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-[#4A4239] md:mt-8 md:text-lg">
                Las recetas de {BRAND_NAME}: de temporada, con sus tiempos reales y paso a paso. Ábrelas y
                cocínalas sin cuenta.
              </p>
            </header>
            {search}
          </>
        ) : (
          /* Row 1 — mobile: title + "+" then the search below; lg: title · search · Nueva receta */
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
            {search}
          </div>
        )}

        {/* Row 2 — one chip row (scrolls on mobile, wraps at lg); on the public grid it scrolls edge to edge */}
        <CatalogChips
          className={`mt-1.5 lg:mt-[22px] ${
            signedOut ? "-mx-6 px-6 md:-mx-10 md:px-10 lg:mx-0 lg:px-0" : "px-5 lg:px-0"
          }`}
          onOpenFilters={openFilters}
          filtersOpen={filtersOpen}
          hiddenFiltersCount={hiddenFiltersCount}
          {...filterState}
        />

        {withWhatIHave && (
          <WithWhatIHavePicker
            className="mt-2.5 lg:mt-4"
            picked={picked}
            onAdd={addPicked}
            onRemove={(id) => setPicked((prev) => prev.filter((p) => p.id !== id))}
          />
        )}

        {!withWhatIHave && (
          <SeasonalProduceRow
            className={`mt-2.5 lg:mt-[22px] ${signedOut ? "" : "px-5 lg:px-0"}`}
            produce={seasonalProduce ?? []}
            selected={produce}
            onSelect={setProduce}
          />
        )}

        {featured.length > 0 && (
          <section aria-label="De temporada" className="mt-2.5 lg:mt-[22px] lg:grid lg:grid-cols-2 lg:gap-5">
            <FeaturedRecipeCard recipe={featured[0]} className={signedOut ? "rounded-[18px]" : ""} />
            {featured[1] && <FeaturedRecipeCard recipe={featured[1]} className="hidden lg:block" />}
          </section>
        )}

        <div className={signedOut ? "pt-3.5 lg:pt-[22px]" : "px-4 pt-3.5 lg:px-0 lg:pt-[22px]"}>
          {!isLoading && !waitingForIngredients && (
            <div className={`mb-3 flex items-center justify-between ${signedOut ? "" : "px-1 lg:px-0"}`}>
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
          {!waitingForIngredients && <CatalogGrid
            recipes={gridRecipes}
            isLoading={isLoading}
            hiddenAtLg={hiddenAtLg}
            emptyState={
              count > 0 ? null : (
                <div className="mt-16 text-center">
                  <p className={`${DISPLAY_UI} text-xl text-ink`}>
                    {withWhatIHave ? "No hay recetas con eso que encajen contigo." : "No hay recetas con esos filtros."}
                  </p>
                  <p className="mt-2 text-sm text-ink-soft">
                    {withWhatIHave
                      ? "Prueba con otro ingrediente o quita alguno."
                      : signedOut
                        ? "Prueba a quitar alguno."
                        : "Prueba a quitarlos o crea una nueva."}
                  </p>
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
          />}
        </div>

        {signedOut && <CatalogueWaitlistCta className="mt-16 md:mt-24" />}
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
