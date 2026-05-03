"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Search, X } from "lucide-react"
import { useRecipes } from "@/hooks/useRecipes"
import type { Recipe } from "@ona/shared"

interface RecipePickerSheetProps {
  open: boolean
  onClose: () => void
  /** Title shown in the sheet header. */
  title: string
  /** Optional helper line under the title (e.g. "para el lunes · cena"). */
  subtitle?: string
  /** Called with the chosen recipe id. The sheet closes after the parent confirms. */
  onPick: (recipe: { id: string; name: string }) => void
}

/**
 * Bottom-sheet recipe picker. Lists recipes from `useRecipes()`, filterable
 * by name. Per the user's design call (#2 → "libre"), the picker does NOT
 * filter by `meal_type` — any recipe can be assigned to any slot.
 */
export function RecipePickerSheet({
  open,
  onClose,
  title,
  subtitle,
  onPick,
}: RecipePickerSheetProps) {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch the full catalog (server already paginates; perPage=300 covers
  // the seeded set + any user-created recipes for now).
  const { data: recipes = [], isLoading } = useRecipes({ perPage: 300 })

  useEffect(() => {
    if (open) {
      setQuery("")
      // Focus the search input on open.
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return recipes
    return recipes.filter((r) => r.name.toLowerCase().includes(q))
  }, [recipes, query])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[480px] rounded-t-3xl bg-[#FAF6EE] pb-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <div className="text-eyebrow text-[#7A7066]">Cambiar plato</div>
            <h2 className="mt-1 font-display text-[1.5rem] leading-tight text-[#1A1612]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-[12px] italic text-[#7A7066]">{subtitle}</p>
            )}
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

        <div className="mt-4 px-5">
          <div className="flex items-center gap-2 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3">
            <Search size={14} className="text-[#7A7066]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar receta…"
              className="flex-1 bg-transparent py-2 text-[14px] text-[#1A1612] outline-none placeholder:text-[#7A7066]"
            />
          </div>
        </div>

        <div className="mt-4 max-h-[60vh] overflow-y-auto px-5">
          {isLoading && (
            <div className="py-8 text-center text-[12px] italic text-[#7A7066]">
              Cargando catálogo…
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="py-8 text-center text-[12px] italic text-[#7A7066]">
              Sin resultados para “{query}”.
            </div>
          )}
          <ul className="divide-y divide-[#DDD6C5]">
            {filtered.slice(0, 100).map((r: Recipe) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick({ id: r.id, name: r.name })}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-[#F2EDE0]"
                >
                  <span className="min-w-0 truncate text-[14px] text-[#1A1612]">
                    {r.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
                    {r.authorId ? "tuya" : "ONA"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
