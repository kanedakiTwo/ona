"use client"

import { motion, AnimatePresence } from "motion/react"
import { Search, X, SlidersHorizontal } from "lucide-react"
import type { Meal, Season } from "@ona/shared"
import { MEAL_LABELS, SEASON_LABELS } from "@/lib/labels"

const MEAL_OPTIONS: { value: Meal; label: string }[] = [
  { value: "breakfast", label: MEAL_LABELS.breakfast },
  { value: "lunch", label: MEAL_LABELS.lunch },
  { value: "dinner", label: MEAL_LABELS.dinner },
  { value: "snack", label: MEAL_LABELS.snack },
]

const SEASON_OPTIONS: { value: Season; label: string }[] = [
  { value: "spring", label: SEASON_LABELS.spring },
  { value: "summer", label: SEASON_LABELS.summer },
  { value: "autumn", label: SEASON_LABELS.autumn },
  { value: "winter", label: SEASON_LABELS.winter },
]

const TIME_OPTIONS = [
  { value: 15, label: "<15 min" },
  { value: 30, label: "<30 min" },
  { value: 60, label: "<60 min" },
]

type Variant = "inline" | "sidebar"

type Props = {
  variant: Variant
  searchQuery: string
  onSearchChange: (v: string) => void
  selectedMeal: Meal | ""
  onMealChange: (v: Meal | "") => void
  selectedSeason: Season | ""
  onSeasonChange: (v: Season | "") => void
  maxTime: number | ""
  onMaxTimeChange: (v: number | "") => void
  scope: "all" | "mine" | "ona"
  onScopeChange: (v: "all" | "mine" | "ona") => void
  householdTags?: { tag: string; count: number }[]
  selectedTags: string[]
  onToggleTag: (tag: string) => void
  filtersOpen: boolean
  onFiltersOpenChange: (open: boolean) => void
  activeFiltersCount: number
  onClearAll: () => void
}

export default function CatalogFilters(props: Props) {
  const {
    variant,
    searchQuery,
    onSearchChange,
    selectedMeal,
    onMealChange,
    selectedSeason,
    onSeasonChange,
    maxTime,
    onMaxTimeChange,
    scope,
    onScopeChange,
    householdTags,
    selectedTags,
    onToggleTag,
    filtersOpen,
    onFiltersOpenChange,
    activeFiltersCount,
    onClearAll,
  } = props

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

  // Shared inner sections used by both variants
  const scopeSegmenter = (
    <div className="px-5 pb-2">
      <div className="inline-flex rounded-full border border-[#DDD6C5] bg-[#FFFEFA] p-0.5">
        {(['all', 'mine', 'ona'] as const).map((s) => {
          const active = scope === s
          const label = s === 'all' ? 'Todas' : s === 'mine' ? 'Mis recetas' : 'Catálogo ONA'
          return (
            <button
              key={s}
              type="button"
              onClick={() => onScopeChange(s)}
              className={`rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] transition-colors ${
                active
                  ? 'bg-[#1A1612] text-[#FAF6EE]'
                  : 'text-[#7A7066] hover:text-[#1A1612]'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )

  const householdTagChips = householdTags && householdTags.length > 0 ? (
    <div className="px-5 pb-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066] mb-1.5">
        Etiquetas propias
      </div>
      <div className="flex flex-wrap gap-1.5">
        {householdTags.map((t) => {
          const active = selectedTags.includes(t.tag)
          return (
            <button
              key={t.tag}
              type="button"
              onClick={() => onToggleTag(t.tag)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] transition-colors ${
                active
                  ? 'bg-[#1A1612] text-[#FAF6EE]'
                  : 'bg-[#F2EDE0] text-[#4A4239] hover:bg-[#DDD6C5]'
              }`}
            >
              {t.tag}
              <span className={active ? 'text-[#FAF6EE]/60' : 'text-[#7A7066]'}>
                {t.count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  ) : null

  const searchBar = (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7A7066]" />
        <input
          type="text"
          placeholder="Buscar receta o ingrediente"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-full border border-[#DDD6C5] bg-[#FFFEFA] py-2.5 pl-9 pr-9 text-[13px] text-[#1A1612] placeholder:text-[#7A7066] focus:border-[#1A1612] focus:outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7A7066] hover:text-[#1A1612]"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {variant === "inline" && (
        <button
          onClick={() => onFiltersOpenChange(!filtersOpen)}
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
      )}
    </div>
  )

  const mealChips = (
    <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      <FilterChip active={!selectedMeal} onClick={() => onMealChange("")}>Todas</FilterChip>
      {MEAL_OPTIONS.map((opt) => (
        <FilterChip
          key={opt.value}
          active={selectedMeal === opt.value}
          onClick={() => onMealChange(selectedMeal === opt.value ? "" : opt.value)}
        >
          {opt.label}
        </FilterChip>
      ))}
    </div>
  )

  const expandedFilterSections = (
    <div className="space-y-4 border-t border-[#DDD6C5] pt-3 mt-2">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066] mb-2">Temporada</div>
        <div className="flex flex-wrap gap-1.5">
          {SEASON_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              active={selectedSeason === opt.value}
              onClick={() => onSeasonChange(selectedSeason === opt.value ? "" : opt.value)}
            >
              {opt.label}
            </FilterChip>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066] mb-2">Tiempo de preparación</div>
        <div className="flex flex-wrap gap-1.5">
          {TIME_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              active={maxTime === opt.value}
              onClick={() => onMaxTimeChange(maxTime === opt.value ? "" : opt.value)}
            >
              {opt.label}
            </FilterChip>
          ))}
        </div>
      </div>
      {activeFiltersCount > 0 && (
        <button
          onClick={onClearAll}
          className="text-[11px] uppercase tracking-[0.15em] text-[#C65D38] hover:underline"
        >
          Limpiar todos
        </button>
      )}
    </div>
  )

  if (variant === "sidebar") {
    return (
      <>
        {scopeSegmenter}
        {householdTagChips}
        <div className="px-5 pb-3 pt-3">
          {searchBar}
          {mealChips}
          {expandedFilterSections}
        </div>
      </>
    )
  }

  // variant === "inline" — sticky bar, AnimatePresence expand panel
  return (
    <>
      {scopeSegmenter}
      {householdTagChips}
      <div className="sticky top-0 z-20 -mx-1 bg-[#FAF6EE]/95 px-5 pb-3 pt-3 backdrop-blur-sm">
        {searchBar}
        {mealChips}
        <AnimatePresence>
          {filtersOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.19, 1, 0.22, 1] }}
              className="overflow-hidden"
            >
              {expandedFilterSections}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
