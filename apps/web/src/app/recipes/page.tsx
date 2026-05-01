"use client"

import { useState, useMemo } from "react"
import { motion, AnimatePresence } from "motion/react"
import { useRecipes } from "@/hooks/useRecipes"
import { useAuth } from "@/lib/auth"
import { Search, Plus, X, SlidersHorizontal } from "lucide-react"
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

const TIME_OPTIONS = [
  { value: 15, label: "<15 min" },
  { value: 30, label: "<30 min" },
  { value: 60, label: "<60 min" },
]

export default function RecipesPage() {
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedMeal, setSelectedMeal] = useState<Meal | "">("")
  const [selectedSeason, setSelectedSeason] = useState<Season | "">("")
  const [maxTime, setMaxTime] = useState<number | "">("")
  const [filtersOpen, setFiltersOpen] = useState(false)

  const { data: recipes, isLoading } = useRecipes({
    search: searchQuery || undefined,
    meal: selectedMeal || undefined,
    perPage: 100,
  })

  // Client-side filtering for season + time
  const filteredRecipes = useMemo(() => {
    if (!recipes) return []
    return recipes.filter((r: any) => {
      if (selectedSeason && !r.seasons?.includes(selectedSeason)) return false
      if (maxTime && r.prepTime && r.prepTime > maxTime) return false
      return true
    })
  }, [recipes, selectedSeason, maxTime])

  const activeFiltersCount =
    (selectedMeal ? 1 : 0) + (selectedSeason ? 1 : 0) + (maxTime ? 1 : 0)

  function clearAll() {
    setSelectedMeal("")
    setSelectedSeason("")
    setMaxTime("")
    setSearchQuery("")
  }

  return (
    <div className="bg-[#FAF6EE] min-h-screen">
      {/* Editorial Header */}
      <div className="px-5 pt-8 pb-4">
        <div className="text-eyebrow mb-2">Catalogo de cocina</div>
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-display text-[2.5rem] leading-[0.95] tracking-tight text-[#1A1612]">
            <span className="font-italic italic text-[#C65D38]">Buen</span><br />comer.
          </h1>
          <Link
            href="/recipes/new"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1A1612] text-[#FAF6EE] shadow-[0_8px_24px_-8px_rgba(26,22,18,0.4)] transition-transform active:scale-95"
            aria-label="Anadir receta"
          >
            <Plus size={18} />
          </Link>
        </div>
      </div>

      {/* Sticky search + filter bar */}
      <div className="sticky top-0 z-20 -mx-1 bg-[#FAF6EE]/95 px-5 pb-3 pt-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7A7066]" />
            <input
              type="text"
              placeholder="Buscar receta o ingrediente"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-full border border-[#DDD6C5] bg-[#FFFEFA] py-2.5 pl-9 pr-9 text-[13px] text-[#1A1612] placeholder:text-[#7A7066] focus:border-[#1A1612] focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7A7066] hover:text-[#1A1612]"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
              filtersOpen || activeFiltersCount > 0
                ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]"
                : "border-[#DDD6C5] bg-[#FFFEFA] text-[#1A1612]"
            }`}
            aria-label="Filtros"
          >
            <SlidersHorizontal size={15} />
            {activeFiltersCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#C65D38] text-[9px] font-bold text-[#FAF6EE]">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>

        {/* Quick meal chips (always visible) */}
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <FilterChip active={!selectedMeal} onClick={() => setSelectedMeal("")}>Todas</FilterChip>
          {MEAL_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              active={selectedMeal === opt.value}
              onClick={() => setSelectedMeal(selectedMeal === opt.value ? "" : opt.value)}
            >
              {opt.label}
            </FilterChip>
          ))}
        </div>

        {/* Expanded filters */}
        <AnimatePresence>
          {filtersOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.19, 1, 0.22, 1] }}
              className="overflow-hidden"
            >
              <div className="space-y-4 border-t border-[#DDD6C5] pt-3 mt-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066] mb-2">Temporada</div>
                  <div className="flex flex-wrap gap-1.5">
                    {SEASON_OPTIONS.map((opt) => (
                      <FilterChip
                        key={opt.value}
                        active={selectedSeason === opt.value}
                        onClick={() => setSelectedSeason(selectedSeason === opt.value ? "" : opt.value)}
                      >
                        {opt.label}
                      </FilterChip>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066] mb-2">Tiempo de preparacion</div>
                  <div className="flex flex-wrap gap-1.5">
                    {TIME_OPTIONS.map((opt) => (
                      <FilterChip
                        key={opt.value}
                        active={maxTime === opt.value}
                        onClick={() => setMaxTime(maxTime === opt.value ? "" : opt.value)}
                      >
                        {opt.label}
                      </FilterChip>
                    ))}
                  </div>
                </div>
                {activeFiltersCount > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-[11px] uppercase tracking-[0.15em] text-[#C65D38] hover:underline"
                  >
                    Limpiar todos
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className="px-5 pb-12 pt-4">
        {/* Result count */}
        {!isLoading && (
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-[0.15em] text-[#7A7066]">
              {filteredRecipes.length} {filteredRecipes.length === 1 ? "receta" : "recetas"}
            </span>
            <span className="font-italic italic text-xs text-[#7A7066]">de temporada</span>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="aspect-[4/5] rounded-2xl bg-[#EFE8D8] animate-pulse" />
                <div className="h-3 w-3/4 rounded bg-[#EFE8D8] animate-pulse" />
                <div className="h-2 w-1/2 rounded bg-[#EFE8D8] animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filteredRecipes.length === 0 && (
          <div className="mt-16 text-center">
            <div className="font-display text-5xl text-[#C65D38]/30">∅</div>
            <p className="mt-4 font-display text-xl text-[#1A1612]">
              No hay recetas con esos filtros.
            </p>
            <p className="mt-2 text-sm text-[#7A7066]">Prueba a quitarlos o crea una nueva.</p>
            {activeFiltersCount > 0 && (
              <button
                onClick={clearAll}
                className="mt-6 text-sm font-medium text-[#2D6A4F] underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}

        {/* Recipe grid */}
        {!isLoading && filteredRecipes.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-6">
            {filteredRecipes.map((recipe: any, i: number) => (
              <motion.div
                key={recipe.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
              >
                <EditorialRecipeCard recipe={recipe} userId={user?.id} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────── */

function FilterChip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-all active:scale-95 ${
        active
          ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]"
          : "border-[#DDD6C5] bg-[#FFFEFA] text-[#4A4239] hover:border-[#1A1612]"
      }`}
    >
      {children}
    </button>
  )
}

function EditorialRecipeCard({ recipe, userId: _userId }: { recipe: any; userId?: string }) {
  const fallbackImg = `https://images.unsplash.com/photo-${recipe.id?.slice(0, 4) === "abcd" ? "1546069901-ba9599a7e63c" : "1490645935967-10de6ba17061"}?w=600&q=80&auto=format&fit=crop`
  const img = recipe.imageUrl || fallbackImg

  const seasonLabel = recipe.seasons?.[0]
  const seasonMap: Record<string, string> = {
    spring: "Primavera",
    summer: "Verano",
    autumn: "Otono",
    winter: "Invierno",
  }

  return (
    <Link href={`/recipes/${recipe.id}`} className="group block">
      <div className="relative overflow-hidden rounded-2xl bg-[#EFE8D8]">
        <div className="aspect-[4/5] overflow-hidden">
          <img
            src={img}
            alt={recipe.name}
            className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:scale-105"
            loading="lazy"
          />
        </div>
        {recipe.prepTime ? (
          <div className="absolute right-2 top-2 rounded-full bg-[#FAF6EE]/95 px-2 py-0.5 text-[10px] font-medium text-[#1A1612] backdrop-blur-sm">
            {recipe.prepTime}'
          </div>
        ) : null}
        {seasonLabel && (
          <div className="absolute left-2 top-2 rounded-full bg-[#1A1612]/70 px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-[#FAF6EE] backdrop-blur-sm">
            {seasonMap[seasonLabel] ?? seasonLabel}
          </div>
        )}
      </div>
      <div className="mt-2.5 space-y-1">
        <h3 className="font-display text-[15px] leading-tight text-[#1A1612] group-hover:text-[#2D6A4F] transition-colors line-clamp-2">
          {recipe.name}
        </h3>
        {recipe.tags?.length > 0 && (
          <p className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066] truncate">
            {recipe.tags.slice(0, 2).join(" · ")}
          </p>
        )}
      </div>
    </Link>
  )
}
