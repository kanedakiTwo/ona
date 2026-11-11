"use client"

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Search, X, Plus, Shuffle } from "lucide-react"
import { useRecipes } from "@/hooks/useRecipes"
import { ApiError } from "@/lib/api"
import { NO_RECIPE_OF_TYPE } from "@/lib/mealSheet"
import { DISH_TYPES, type Recipe } from "@ona/shared"

interface RecipePickerSheetProps {
  open: boolean
  onClose: () => void
  /** Title shown in the sheet header. */
  title: string
  /** Optional helper line under the title (e.g. "para el lunes · cena"). */
  subtitle?: string
  /** Called with the chosen recipe. The sheet closes after the parent confirms. */
  onPick: (recipe: { id: string; name: string; imageUrl?: string | null }) => void
  /**
   * PRO-74: with 0 results, «Usar "<lo escrito>" como plato» puts the typed
   * text in the slot instead of the current dish (a note, not one more dish).
   */
  onUseText?: (text: string) => void
  /**
   * PRO-1175: «Que elija Mimoia», fixed at the bottom — Mimoia puts a recipe
   * that fits the meal, of the type chip chosen if there is one. Resolves when
   * it's saved (the parent closes the sheet); a rejection is said here and the
   * sheet stays open (no recipe of that type fits, 409 NO_RECIPE_OF_TYPE).
   */
  onPickAuto?: (dishType: string | null) => Promise<unknown>
}

/**
 * Bottom-sheet recipe picker. Lists recipes from `useRecipes()`, filterable
 * by name. Per the user's design call (#2 → "libre"), the picker does NOT
 * filter by `meal_type` — any recipe can be assigned to any slot. It DOES
 * hide recipes that break the user's allergies or diet (`fitsMe`, PRO-61):
 * a vegetarian must never be offered chicken here.
 *
 * Layout (Miguel, 2026-11-10): the search field sits at the bottom of the
 * sheet and the results above it, in a list with its own scroll, so the field
 * never moves when the number of results changes. The sheet has a fixed
 * height and follows the visible viewport (`useVisibleViewport`), so on a
 * phone the keyboard pushes the field up instead of covering it.
 * The catalogue is only asked for while the sheet is open (2026-11-10: every
 * slot's closed picker asked for it when /menu loaded, ~4 s of server work).
 *
 * PRO-1175: type chips on top (`DISH_TYPES`, «Legumbres», «Cremas y sopas»…)
 * only filter the list (`GET /recipes?fitsMe=1&dishType=…`); with
 * `onPickAuto`, «Que elija Mimoia» sits at the bottom and uses the chip.
 * «Cambiar al azar» and «Tipo de comida» left the meal sheet for these.
 */
export function RecipePickerSheet({
  open,
  onClose,
  title,
  subtitle,
  onPick,
  onUseText,
  onPickAuto,
}: RecipePickerSheetProps) {
  const [query, setQuery] = useState("")
  const [dishType, setDishType] = useState<string | null>(null)
  const [auto, setAuto] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const inputRef = useRef<HTMLInputElement>(null)

  // The API searches the whole catalogue, minus what breaks the user's
  // allergies or diet. It returns 100 at most, and the newest recipes come
  // last: searching inside that first page left them out (2026-11-03, a
  // recipe found by /recipes but not here — 382nd of 382).
  const search = useDeferredValue(query.trim())
  const { data: recipes = [], isLoading, isPlaceholderData } = useRecipes(
    { perPage: 100, fitsMe: true, search: search || undefined, dishType: dishType ?? undefined },
    { keepPrevious: true, enabled: open },
  )
  const viewport = useVisibleViewport(open)
  // The list on screen is for an older query: don't say «Sin resultados» yet.
  const searching = isPlaceholderData || search !== query.trim()

  useEffect(() => {
    if (open) {
      setQuery("")
      setDishType(null)
      setAuto({ busy: false, error: null })
      // Focus the search input on open.
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Narrows the previous results at once while the server's answer arrives.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return recipes
    return recipes.filter((r) => r.name.toLowerCase().includes(q))
  }, [recipes, query])

  if (!open) return null

  async function pickAuto() {
    if (!onPickAuto || auto.busy) return
    setAuto({ busy: true, error: null })
    try {
      await onPickAuto(dishType)
      setAuto({ busy: false, error: null })
    } catch (err) {
      const said = err instanceof ApiError && err.code === NO_RECIPE_OF_TYPE ? err.message : "No se ha podido elegir. Prueba otra vez."
      setAuto({ busy: false, error: said })
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-x-0 top-0 z-[80] flex h-[100dvh] items-end justify-center bg-black/40 lg:items-center"
      style={viewport ? { top: viewport.top, height: viewport.height } : undefined}
      onClick={onClose}
    >
      <div
        data-testid="recipe-picker"
        className="relative flex h-[88%] max-h-[680px] w-full max-w-[480px] flex-col rounded-t-3xl bg-[#FAF6EE] shadow-2xl lg:h-[80%] lg:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <div className="text-eyebrow text-[#7A7066]">Cambiar plato</div>
            <h2 className="mt-1 font-display text-[1.5rem] leading-tight text-[#1A1612]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-[12px] italic text-[#7A7066]">{subtitle}</p>
            )}
            <p className="mt-1 text-[11px] text-[#7A7066]" data-testid="picker-restrictions-note">
              Solo salen las recetas que encajan con tus alergias y tu dieta.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-[#7A7066] hover:text-[#1A1612]"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div
          role="group"
          aria-label="Tipo de plato"
          data-testid="picker-type-chips"
          className="mt-3 flex shrink-0 gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none]"
        >
          {DISH_TYPES.map((t) => {
            const on = dishType === t.key
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                disabled={auto.busy}
                onClick={() => {
                  setDishType(on ? null : t.key)
                  setAuto((a) => ({ ...a, error: null }))
                }}
                className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors ${
                  on ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]" : "border-[#DDD6C5] bg-[#FFFEFA] text-[#1A1612] hover:border-[#1A1612]"
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5" data-testid="picker-results">
          {(isLoading || (searching && filtered.length === 0)) && (
            <div className="py-8 text-center text-[12px] italic text-[#7A7066]">
              {isLoading ? "Cargando catálogo…" : "Buscando…"}
            </div>
          )}
          {!isLoading && !searching && filtered.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-[12px] italic text-[#7A7066]">
                {query.trim()
                  ? `Sin resultados para “${query.trim()}”.`
                  : dishType
                    ? "No hay recetas de este tipo que encajen con tu dieta."
                    : "Sin recetas en el catálogo todavía."}
              </p>
              <Link
                href={
                  query.trim()
                    ? `/recipes/new?name=${encodeURIComponent(query.trim())}`
                    : "/recipes/new"
                }
                onClick={onClose}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-4 py-2 text-[13px] font-medium text-[#FAF6EE] transition-colors hover:bg-[#2D6A4F]"
              >
                <Plus size={14} />
                Crear receta{query.trim() ? ` “${query.trim()}”` : ""}
              </Link>
              {onUseText && query.trim() && (
                <div>
                  <button
                    type="button"
                    onClick={() => onUseText(query.trim().slice(0, 120))}
                    className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-4 text-[13px] font-medium text-[#1A1612] transition-colors hover:border-[#1A1612]"
                  >
                    Usar “{query.trim()}” como plato
                  </button>
                </div>
              )}
            </div>
          )}
          <ul className="divide-y divide-[#DDD6C5]">
            {filtered.map((r: Recipe) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={auto.busy}
                  onClick={() => onPick({ id: r.id, name: r.name, imageUrl: r.imageUrl ?? null })}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-[#F2EDE0]"
                >
                  <span className="min-w-0 truncate text-[14px] text-[#1A1612]">
                    {r.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
                    {r.authorId ? "tuya" : "Mimoia"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Fixed at the bottom: the results change above it, never its place. */}
        <div
          className="shrink-0 border-t border-[#E8E2D3] px-5 pt-3 pb-[calc(12px+var(--safe-bottom))] lg:pb-4"
          data-testid="picker-search"
        >
          {onPickAuto && (
            <div className="mb-2.5">
              <button
                type="button"
                onClick={pickAuto}
                disabled={auto.busy}
                aria-describedby="picker-auto-hint"
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-[#1A1612] px-4 text-[14px] font-medium text-[#1A1612] transition-colors hover:bg-[#F2EDE0] disabled:opacity-50"
              >
                <Shuffle size={15} />
                {auto.busy ? "Eligiendo…" : "Que elija Mimoia"}
              </button>
              <p id="picker-auto-hint" className="mt-1 text-center text-[11px] text-[#7A7066]">
                {dishType
                  ? `Una de «${DISH_TYPES.find((t) => t.key === dishType)?.label ?? dishType}» que encaje con tu semana`
                  : "Una receta que encaje con tu semana"}
              </p>
              {auto.error && (
                <p role="alert" className="mt-1 text-center text-[12px] text-[#A8452A]">
                  {auto.error}
                </p>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3">
            <Search size={14} className="text-[#7A7066]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar receta…"
              aria-label="Buscar receta"
              className="min-h-[44px] flex-1 bg-transparent py-2 text-[16px] text-[#1A1612] outline-none placeholder:text-[#7A7066]"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The part of the screen the keyboard leaves (`visualViewport`), while the
 * sheet is open. Android Chrome and iOS Safari don't shrink the layout
 * viewport when the keyboard opens, so a field fixed at the bottom would sit
 * under it; following the visible viewport keeps it above the keyboard.
 * Null where the API doesn't exist (the sheet then fills `100dvh`).
 */
function useVisibleViewport(active: boolean): { top: number; height: number } | null {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null
    if (!active || !vv) {
      setBox(null)
      return
    }
    const update = () => setBox({ top: vv.offsetTop, height: vv.height })
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [active])
  return box
}