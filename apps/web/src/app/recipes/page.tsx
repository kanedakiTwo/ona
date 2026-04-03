"use client"

import { useState, useMemo } from "react"
import { useRecipes } from "@/hooks/useRecipes"
import { useAuth } from "@/lib/auth"
import { RecipeCard } from "@/components/recipes/RecipeCard"
import { Search, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import type { Meal, Season } from "@ona/shared"

const MEAL_OPTIONS: { value: Meal; label: string }[] = [
  { value: "breakfast", label: "Desayuno" },
  { value: "lunch", label: "Comida" },
  { value: "dinner", label: "Cena" },
  { value: "snack", label: "Snack" },
]

const SEASON_OPTIONS: { value: Season; label: string }[] = [
  { value: "spring", label: "Primavera" },
  { value: "summer", label: "Verano" },
  { value: "autumn", label: "Otono" },
  { value: "winter", label: "Invierno" },
]

export default function RecipesPage() {
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMeals, setSelectedMeals] = useState<Meal[]>([])
  const [selectedSeason, setSelectedSeason] = useState<Season | "">("")
  const [sourceFilter, setSourceFilter] = useState<"all" | "ona" | "mine">("all")

  // Build filter tags from selected meals + season
  const filterTags = useMemo(() => {
    const tags: string[] = [...selectedMeals]
    if (selectedSeason) tags.push(selectedSeason)
    return tags.length > 0 ? tags : undefined
  }, [selectedMeals, selectedSeason])

  const {
    data: recipes,
    isLoading,
    error,
  } = useRecipes({
    search: searchQuery || undefined,
    tags: filterTags,
  })

  const filteredRecipes = useMemo(() => {
    if (!recipes) return []
    return recipes.filter((r: any) => {
      if (sourceFilter === "ona") return r.authorId === null || r.authorId === undefined
      if (sourceFilter === "mine") return r.authorId != null
      return true
    })
  }, [recipes, sourceFilter])

  function toggleMealFilter(meal: Meal) {
    setSelectedMeals((prev) =>
      prev.includes(meal) ? prev.filter((m) => m !== meal) : [...prev, meal]
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Recetas</h1>
        <Link
          href="/recipes/new"
          className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          <Plus size={16} />
          Anadir receta
        </Link>
      </div>

      {/* Search bar */}
      <div className="relative mt-6">
        <Search
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          placeholder="Buscar recetas..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-4 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
        />
      </div>

      {/* Source filter tabs */}
      <div className="mt-4 flex gap-1 rounded-lg bg-gray-100 p-1">
        {([
          { value: "all" as const, label: "Todas" },
          { value: "ona" as const, label: "ONA" },
          { value: "mine" as const, label: "Mis recetas" },
        ]).map((tab) => (
          <button
            key={tab.value}
            onClick={() => setSourceFilter(tab.value)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              sourceFilter === tab.value
                ? "bg-white text-black shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {/* Meal type checkboxes */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Comida:</span>
          {MEAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => toggleMealFilter(opt.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                selectedMeals.includes(opt.value)
                  ? "border-black bg-black text-white"
                  : "border-gray-300 text-gray-600 hover:border-gray-400"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Season filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Temporada:</span>
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value as Season | "")}
            className="rounded-lg border border-gray-300 px-3 py-1 text-xs focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
          >
            <option value="">Todas</option>
            {SEASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="mt-12 text-center">
          <p className="text-gray-500">Cargando recetas...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-600">
          Error al cargar las recetas.
        </div>
      )}

      {/* Empty state */}
      {recipes && filteredRecipes.length === 0 && (
        <div className="mt-12 rounded-xl border border-dashed border-gray-300 py-12 text-center">
          <p className="text-gray-500">No se encontraron recetas.</p>
        </div>
      )}

      {/* Recipe grid */}
      {filteredRecipes.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRecipes.map((recipe: any) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              isFavorite={recipe.is_favorite}
              userId={user?.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
