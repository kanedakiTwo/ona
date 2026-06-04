"use client"

import { useEffect, useMemo, useState } from "react"
import { useRecipes } from "@/hooks/useRecipes"
import { useHouseholdCustomTags } from "@/hooks/useRecipeNotes"
import { useAuth } from "@/lib/auth"
import { Plus } from "lucide-react"
import Link from "next/link"
import type { Meal, Season } from "@ona/shared"
import CatalogFilters from "@/components/recipes/CatalogFilters"
import CatalogGrid from "@/components/recipes/CatalogGrid"

export default function RecipesPage() {
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMeal, setSelectedMeal] = useState<Meal | "">("")
  const [selectedSeason, setSelectedSeason] = useState<Season | "">("")
  const [maxTime, setMaxTime] = useState<number | "">("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  /**
   * Catalog scope filter (per the user's design call):
   *   - 'all'  : todas las recetas (catálogo ONA + las del usuario, mezcladas — comportamiento histórico)
   *   - 'mine' : sólo las del usuario actual (`recipe.authorId === user.id`)
   *   - 'ona'  : sólo las del catálogo ONA (`recipe.authorId === null`)
   * Persisted in `localStorage` so the choice survives reloads.
   */
  const [scope, setScope] = useState<"all" | "mine" | "ona">("all")
  /** PR 8B-2 — selected household custom tags (AND filter). */
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("ona.recipes.scope") : null
    if (saved === "all" || saved === "mine" || saved === "ona") setScope(saved)
  }, [])
  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }
  const { data: householdTags } = useHouseholdCustomTags()
  function setScopeAndPersist(next: "all" | "mine" | "ona") {
    setScope(next)
    if (typeof window !== "undefined") localStorage.setItem("ona.recipes.scope", next)
  }

  const { data: recipes, isLoading } = useRecipes({
    search: searchQuery || undefined,
    meal: selectedMeal || undefined,
    customTags: selectedTags.length > 0 ? selectedTags : undefined,
    perPage: 100,
  })

  // Client-side filtering for season + time + scope
  const filteredRecipes = useMemo(() => {
    if (!recipes) return []
    return recipes.filter((r: any) => {
      if (scope === "mine" && r.authorId !== user?.id) return false
      if (scope === "ona" && r.authorId !== null) return false
      if (selectedSeason && !r.seasons?.includes(selectedSeason)) return false
      if (maxTime && r.prepTime && r.prepTime > maxTime) return false
      return true
    })
  }, [recipes, selectedSeason, maxTime, scope, user?.id])

  const activeFiltersCount =
    (selectedMeal ? 1 : 0) + (selectedSeason ? 1 : 0) + (maxTime ? 1 : 0)

  function clearAll() {
    setSelectedMeal("")
    setSelectedSeason("")
    setMaxTime("")
    setSearchQuery("")
    setScopeAndPersist("all")
    setSelectedTags([])
  }

  const filterProps = {
    searchQuery,
    onSearchChange: setSearchQuery,
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
    filtersOpen,
    onFiltersOpenChange: setFiltersOpen,
    activeFiltersCount,
    onClearAll: clearAll,
  } as const

  return (
    <div className="bg-[#FAF6EE] min-h-screen">
      {/* Editorial Header — single-column block above the 2-col shell */}
      <div className="px-5 pt-8 pb-4 lg:px-8 lg:max-w-[1200px] lg:mx-auto">
        <div className="text-eyebrow mb-2">Catálogo de cocina</div>
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-display text-[2.5rem] leading-[0.95] tracking-tight text-[#1A1612]">
            <span className="font-italic italic text-[#C65D38]">Buen</span><br />comer.
          </h1>
          <Link
            href="/recipes/new"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1A1612] text-[#FAF6EE] shadow-[0_8px_24px_-8px_rgba(26,22,18,0.4)] transition-transform active:scale-95"
            aria-label="Añadir receta"
          >
            <Plus size={18} />
          </Link>
        </div>
      </div>

      {/* At lg+: 2-column shell (filters sidebar + main area). At < lg: stacked. */}
      <div className="lg:mx-auto lg:max-w-[1200px] lg:px-8 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8 lg:items-start">
        {/* Filters: inline (with expand panel) at < lg */}
        <div className="lg:hidden">
          <CatalogFilters variant="inline" {...filterProps} />
        </div>
        {/* Filters: always-visible sidebar at lg+ */}
        <aside className="hidden lg:block lg:sticky lg:top-6">
          <CatalogFilters variant="sidebar" {...filterProps} />
        </aside>

        {/* Main column: result count + grid */}
        <div>
          <div className="px-5 pb-12 pt-4 lg:px-0">
            {!isLoading && (
              <div className="mb-4 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-[0.15em] text-[#7A7066]">
                  {filteredRecipes.length} {filteredRecipes.length === 1 ? "receta" : "recetas"}
                </span>
                <span className="font-italic italic text-xs text-[#7A7066]">de temporada</span>
              </div>
            )}
            <CatalogGrid
              recipes={filteredRecipes}
              userId={user?.id}
              isLoading={isLoading}
              emptyState={
                <div className="mt-16 text-center">
                  <div className="font-display text-5xl text-[#C65D38]/30">∅</div>
                  <p className="mt-4 font-display text-xl text-[#1A1612]">No hay recetas con esos filtros.</p>
                  <p className="mt-2 text-sm text-[#7A7066]">Prueba a quitarlos o crea una nueva.</p>
                  {activeFiltersCount > 0 && (
                    <button onClick={clearAll} className="mt-6 text-sm font-medium text-[#2D6A4F] underline">
                      Limpiar filtros
                    </button>
                  )}
                </div>
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}
