"use client"

/**
 * IngredientAutocomplete — replaces the closed datalist picker on /recipes/new.
 *
 * Behavior:
 *   - Debounced search against GET /ingredients?search=
 *   - Click a result → onSelect(ingredient)
 *   - When nothing matches exactly AND ≥ 2 chars typed (PRO-1125):
 *       · if the search found nothing, the catalogue's look-alikes first
 *         («¿Es manitas de cerdo?», GET /ingredients/similar);
 *       · then «Añadir "{name}"», which creates the row with its name
 *         (POST /ingredients/auto-create, allergens inferred from the name)
 *         and selects it. No modal and no USDA list: the recipe saves with
 *         «nutrición incompleta» until Cocina fills the values.
 */

import { useEffect, useRef, useState } from "react"
import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { hasSameIngredientName, type Ingredient } from "@ona/shared"
import {
  useAutoCreateIngredient,
  useSearchIngredients,
  useSimilarIngredients,
} from "@/hooks/useIngredients"

interface Props {
  /** Currently-selected ingredient (controlled) */
  value: Ingredient | null
  /** Called when the user picks an existing ingredient OR adds a new one */
  onSelect: (ing: Ingredient) => void
  /** Optional placeholder */
  placeholder?: string
  /** Marks the input border red */
  hasError?: boolean
  /** Stable id used for ARIA hooks (multiple rows on the page) */
  inputId?: string
  /**
   * Free-form text to show in the input when no `value` is selected — e.g.
   * the raw name returned by the photo/URL extractor for an ingredient that
   * didn't match the catalog. Lets the user see what the LLM tried so they
   * can confirm (via «Añadir»), refine, or pick a similar existing row.
   */
  defaultText?: string
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const OPTION =
  "block min-h-11 w-full px-3.5 py-2.5 text-left text-[15px] text-ink hover:bg-cream-deep"

export function IngredientAutocomplete({
  value,
  onSelect,
  placeholder,
  hasError,
  inputId,
  defaultText,
}: Props) {
  const [query, setQuery] = useState(value?.name ?? defaultText ?? "")
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const create = useAutoCreateIngredient()

  // Keep input in sync if the parent swaps the selected ingredient OR
  // injects a fresh defaultText (e.g. after the user uploads a new photo).
  useEffect(() => {
    if (value && value.name !== query) {
      setQuery(value.name)
      return
    }
    if (!value && defaultText && defaultText !== query && query === "") {
      setQuery(defaultText)
    }
  }, [value, defaultText]) // eslint-disable-line react-hooks/exhaustive-deps

  const debounced = useDebounced(query, 200)
  const search = useSearchIngredients(debounced)
  const results = search.data ?? []

  const trimmed = query.trim()
  // The debounced search must have caught up with what is typed.
  const settled = !search.isLoading && debounced.trim() === trimmed
  // Without case or accents: "Brocoli" doesn't offer to create a second "brócoli"
  const showCreateOption =
    trimmed.length >= 2 && settled && !hasSameIngredientName(results, trimmed)
  const similar = useSimilarIngredients(trimmed, open && showCreateOption && results.length === 0)
  const lookAlikes = results.length === 0 ? (similar.data ?? []) : []

  // Close dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  function pick(ing: Ingredient) {
    setQuery(ing.name)
    setError(null)
    onSelect(ing)
    setOpen(false)
  }

  function add() {
    setError(null)
    create.mutate(
      { name: trimmed },
      {
        onSuccess: (resp) => pick(resp.ingredient),
        onError: (err) => setError(err.message || "No se pudo añadir el ingrediente."),
      },
    )
  }

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <input
        id={inputId}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setError(null)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? "Ingrediente"}
        autoComplete="off"
        className={cn(
          "h-11 w-full rounded-xl border bg-paper px-3.5 text-[16px] text-ink placeholder:text-ink-light focus:outline-none focus:ring-1 lg:text-[15px]",
          hasError
            ? "border-terracotta focus:border-terracotta focus:ring-terracotta"
            : "border-border-soft focus:border-ink focus:ring-ink"
        )}
      />

      {open && (search.data || search.isLoading || showCreateOption) && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-2xl border border-border-soft bg-paper py-1 shadow-[0_12px_32px_-12px_rgba(26,22,18,0.3)]"
        >
          {search.isLoading && (
            <li className="px-3 py-2 text-[12px] italic text-ink-muted">
              Cargando...
            </li>
          )}
          {!search.isLoading &&
            results.map((ing) => (
              <li key={ing.id}>
                <button type="button" onClick={() => pick(ing)} className={OPTION}>
                  {ing.name}
                </button>
              </li>
            ))}
          {showCreateOption &&
            lookAlikes.map((ing) => (
              <li key={ing.id}>
                <button type="button" onClick={() => pick(ing)} className={OPTION}>
                  ¿Es <span className="italic">{ing.name}</span>?
                </button>
              </li>
            ))}
          {showCreateOption && (
            <li className="mt-1 border-t border-border-soft pt-1">
              <button
                type="button"
                onClick={add}
                disabled={create.isPending}
                className="flex min-h-11 w-full items-center gap-2 px-3.5 py-2.5 text-left text-[14px] font-medium text-terracotta-deep hover:bg-cream-deep disabled:opacity-60"
              >
                <Plus size={14} />
                {create.isPending ? "Añadiendo…" : "Añadir"}
                <span className="italic text-ink">
                  &ldquo;{trimmed}&rdquo;
                </span>
              </button>
            </li>
          )}
          {!search.isLoading &&
            results.length === 0 &&
            !showCreateOption && (
              <li className="px-3 py-2 text-[12px] italic text-ink-muted">
                Empieza a escribir para buscar...
              </li>
            )}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-1 text-[12px] text-terracotta-deep">
          {error}
        </p>
      )}
    </div>
  )
}
