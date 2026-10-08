"use client"

import { useEffect, useId, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Search, X, SlidersHorizontal } from "lucide-react"
import type { CatalogScope, Meal, Season } from "@ona/shared"
import { MEAL_LABELS, SEASON_LABELS } from "@/lib/labels"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"

/**
 * `/recipes` filters ("D · Luz y foto"):
 *   - `CatalogSearch`: one search field; on mobile the "Más filtros" button
 *     lives inside it.
 *   - `CatalogChips`: ONE chip row merging the old scope tabs and quick
 *     filters (De temporada, En 30 min, meals, Selección Mimoia, Mis recetas).
 *     No chip active = "Todas". At `lg+` the row wraps and ends in a
 *     "Más filtros" link.
 *   - `CatalogFiltersSheet`: the advanced filters dialog (bottom sheet on
 *     mobile, centred panel at `md+`): seasons, total time, meals, recipe
 *     origin and household tags.
 * State lives in the page; every component is controlled.
 */

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
  { value: 15, label: "Hasta 15 min" },
  { value: 30, label: "Hasta 30 min" },
  { value: 60, label: "Hasta 60 min" },
]

/** The "En 30 min" quick chip is the 30-minute time filter. */
export const QUICK_MAX_TIME = 30

type CatalogFilterControls = {
  selectedMeal: Meal | ""
  onMealChange: (v: Meal | "") => void
  selectedSeason: Season | ""
  onSeasonChange: (v: Season | "") => void
  maxTime: number | ""
  onMaxTimeChange: (v: number | "") => void
  scope: CatalogScope
  onScopeChange: (v: CatalogScope) => void
  householdTags?: { tag: string; count: number }[]
  selectedTags: string[]
  onToggleTag: (tag: string) => void
  /** Season "now" (`detectSeason`), used by the "De temporada" chip. */
  currentSeason: Season
}

// Module scope so React doesn't remount every chip per keystroke.
function Chip({
  active,
  onClick,
  children,
  size = "row",
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  size?: "row" | "sheet"
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      // 36 px visual (38 at lg) + a pseudo-element that extends the hit area to 44 px.
      className={`relative h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[14px] transition-colors before:absolute before:inset-x-0 before:-inset-y-1 active:scale-[0.97] ${
        size === "row" ? "lg:h-[38px] lg:px-4" : ""
      } ${
        active
          ? "border-ink bg-ink font-medium text-cream"
          : "border-border bg-paper text-ink hover:border-ink"
      }`}
    >
      {children}
    </button>
  )
}

/* ─── Search ─────────────────────────────────────────────────────── */

export function CatalogSearch({
  searchQuery,
  onSearchChange,
  onOpenFilters,
  filtersOpen,
  hiddenFiltersCount,
  className = "",
}: {
  searchQuery: string
  onSearchChange: (v: string) => void
  onOpenFilters: () => void
  filtersOpen: boolean
  /** Active filters that have no chip in the row (shown as a badge). */
  hiddenFiltersCount: number
  className?: string
}) {
  return (
    <div
      className={`flex h-12 items-center gap-2.5 rounded-full border border-border bg-paper pl-4 pr-0.5 transition-colors focus-within:border-ink lg:pr-4 ${className}`}
    >
      <Search size={18} strokeWidth={2} className="shrink-0 text-ink-soft" aria-hidden="true" />
      <label htmlFor="recipes-search" className="sr-only">
        Buscar recetas
      </label>
      <input
        id="recipes-search"
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Busca una receta"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-soft"
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => onSearchChange("")}
          aria-label="Borrar búsqueda"
          className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:text-ink lg:-mr-3"
        >
          <X size={16} />
        </button>
      )}
      <button
        type="button"
        onClick={onOpenFilters}
        aria-label="Más filtros"
        aria-haspopup="dialog"
        aria-expanded={filtersOpen}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full lg:hidden"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cream-deep text-ink">
          <SlidersHorizontal size={17} strokeWidth={2} aria-hidden="true" />
        </span>
        {hiddenFiltersCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-terracotta px-1 text-[10px] font-bold text-paper">
            {hiddenFiltersCount}
          </span>
        )}
      </button>
    </div>
  )
}

/* ─── Chip row ───────────────────────────────────────────────────── */

export function CatalogChips({
  onOpenFilters,
  filtersOpen,
  hiddenFiltersCount,
  className = "",
  ...f
}: CatalogFilterControls & {
  onOpenFilters: () => void
  filtersOpen: boolean
  hiddenFiltersCount: number
  className?: string
}) {
  const toggleScope = (s: CatalogScope) => f.onScopeChange(f.scope === s ? "all" : s)
  return (
    <div
      role="group"
      aria-label="Filtros rápidos"
      className={`scrollbar-none flex gap-2 overflow-x-auto px-5 py-1 lg:flex-wrap lg:overflow-visible lg:px-0 lg:py-0 ${className}`}
    >
      <Chip
        active={f.selectedSeason === f.currentSeason}
        onClick={() => f.onSeasonChange(f.selectedSeason === f.currentSeason ? "" : f.currentSeason)}
      >
        De temporada
      </Chip>
      <Chip
        active={f.maxTime === QUICK_MAX_TIME}
        onClick={() => f.onMaxTimeChange(f.maxTime === QUICK_MAX_TIME ? "" : QUICK_MAX_TIME)}
      >
        En 30 min
      </Chip>
      {MEAL_OPTIONS.map((opt) => (
        <Chip
          key={opt.value}
          active={f.selectedMeal === opt.value}
          onClick={() => f.onMealChange(f.selectedMeal === opt.value ? "" : opt.value)}
        >
          {opt.label}
        </Chip>
      ))}
      <Chip active={f.scope === "ona"} onClick={() => toggleScope("ona")}>
        Selección Mimoia
      </Chip>
      <Chip active={f.scope === "mine"} onClick={() => toggleScope("mine")}>
        Mis recetas
      </Chip>
      <button
        type="button"
        onClick={onOpenFilters}
        aria-haspopup="dialog"
        aria-expanded={filtersOpen}
        className="hidden h-[38px] shrink-0 rounded-full px-4 text-[14px] font-semibold text-ink underline underline-offset-4 hover:text-terracotta lg:inline-flex lg:items-center"
      >
        Más filtros{hiddenFiltersCount > 0 ? ` (${hiddenFiltersCount})` : ""}
      </button>
    </div>
  )
}

/* ─── Advanced filters dialog ────────────────────────────────────── */

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
          {title}
        </h3>
        {hint && <span className="text-[12px] text-ink-soft">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-2 py-1">{children}</div>
    </div>
  )
}

export function CatalogFiltersSheet({
  open,
  onClose,
  resultCount,
  anyFilterActive,
  onClearAll,
  ...f
}: CatalogFilterControls & {
  open: boolean
  onClose: () => void
  resultCount: number
  anyFilterActive: boolean
  onClearAll: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  // Latest onClose without re-running the open/close effect on every render
  // (that would bounce focus back to the opener on each chip tap).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Focus in on open, Escape closes, Tab stays inside, focus back on close.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const t = window.setTimeout(() => closeRef.current?.focus(), 30)
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== "Tab" || !panelRef.current) return
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  }, [open])

  const seasonNow = SEASON_LABELS[f.currentSeason]

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center md:items-center md:p-6">
          <motion.div
            className="absolute inset-0 bg-ink/40"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.19, 1, 0.22, 1] }}
            className="relative flex max-h-[88dvh] w-full max-w-[480px] flex-col rounded-t-[28px] bg-cream shadow-2xl md:max-w-[520px] md:rounded-[28px]"
          >
            <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
              <h2 id={titleId} className={`${DISPLAY_UI} text-[24px] leading-tight text-ink`}>
                Filtros
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Cerrar filtros"
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-soft hover:text-ink"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-4 pt-2">
              <Group title="Temporada" hint={`Ahora: ${seasonNow.toLowerCase()}`}>
                {SEASON_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.value}
                    size="sheet"
                    active={f.selectedSeason === opt.value}
                    onClick={() => f.onSeasonChange(f.selectedSeason === opt.value ? "" : opt.value)}
                  >
                    {opt.label}
                  </Chip>
                ))}
              </Group>

              <Group title="Tiempo total">
                {TIME_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.value}
                    size="sheet"
                    active={f.maxTime === opt.value}
                    onClick={() => f.onMaxTimeChange(f.maxTime === opt.value ? "" : opt.value)}
                  >
                    {opt.label}
                  </Chip>
                ))}
              </Group>

              <Group title="Comida">
                {MEAL_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.value}
                    size="sheet"
                    active={f.selectedMeal === opt.value}
                    onClick={() => f.onMealChange(f.selectedMeal === opt.value ? "" : opt.value)}
                  >
                    {opt.label}
                  </Chip>
                ))}
              </Group>

              <Group title="Recetas">
                {(
                  [
                    ["all", "Todas"],
                    ["ona", "Selección Mimoia"],
                    ["mine", "Mis recetas"],
                  ] as const
                ).map(([value, label]) => (
                  <Chip key={value} size="sheet" active={f.scope === value} onClick={() => f.onScopeChange(value)}>
                    {label}
                  </Chip>
                ))}
              </Group>

              {f.householdTags && f.householdTags.length > 0 && (
                <Group title="Etiquetas propias">
                  {f.householdTags.map((t) => (
                    <Chip
                      key={t.tag}
                      size="sheet"
                      active={f.selectedTags.includes(t.tag)}
                      onClick={() => f.onToggleTag(t.tag)}
                    >
                      {t.tag} <span className="opacity-60">{t.count}</span>
                    </Chip>
                  ))}
                </Group>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border-soft px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
              <button
                type="button"
                onClick={onClearAll}
                disabled={!anyFilterActive}
                className="h-11 rounded-full px-1 text-[14px] font-medium text-ink underline underline-offset-4 disabled:text-ink-light disabled:no-underline"
              >
                Limpiar todo
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-full bg-ink px-5 text-[15px] font-semibold text-cream transition-colors hover:bg-forest"
              >
                Ver {resultCount} {resultCount === 1 ? "receta" : "recetas"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
