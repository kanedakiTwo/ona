"use client"

import { useEffect, useId, useState } from "react"
import { Search, X } from "lucide-react"
import type { Ingredient } from "@ona/shared"
import { useSearchIngredients } from "@/hooks/useIngredients"

/** «Con lo que tengo» (PRO-31): up to this many ingredients. */
export const MAX_WITH_WHAT_I_HAVE = 3

export type PickedIngredient = Pick<Ingredient, "id" | "name">

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Panel under the chip row while «Con lo que tengo» is on: pick 1–3
 * catalogue ingredients (search → tap), shown as removable chips. Only
 * existing catalogue ingredients — no "crear ingrediente" here.
 */
export function WithWhatIHavePicker({
  picked,
  onAdd,
  onRemove,
  className = "",
}: {
  picked: PickedIngredient[]
  onAdd: (ing: PickedIngredient) => void
  onRemove: (id: string) => void
  className?: string
}) {
  const [query, setQuery] = useState("")
  const debounced = useDebounced(query, 200)
  const { data: results, isFetching } = useSearchIngredients(debounced)
  const inputId = useId()
  const listId = useId()
  const full = picked.length >= MAX_WITH_WHAT_I_HAVE
  const pickedIds = new Set(picked.map((p) => p.id))
  const q = debounced.trim().toLowerCase()
  // Exact name first, then names starting with what was typed, then the rest.
  const rank = (name: string) => (name.toLowerCase() === q ? 0 : name.toLowerCase().startsWith(q) ? 1 : 2)
  const options =
    q.length >= 2
      ? (results ?? [])
          .filter((r) => !pickedIds.has(r.id))
          .sort((x, y) => rank(x.name) - rank(y.name))
          .slice(0, 8)
      : []

  return (
    <section
      aria-label="Con lo que tengo"
      className={`mx-4 rounded-[20px] border border-border-soft bg-paper px-4 py-3.5 lg:mx-0 lg:max-w-[640px] ${className}`}
    >
      <p className="text-[14px] leading-snug text-ink">
        ¿Qué tienes? Elige hasta {MAX_WITH_WHAT_I_HAVE} ingredientes.
        <span className="text-ink-soft"> Sal, aceite, agua, pimienta y harina se dan por hechos.</span>
      </p>

      {picked.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Ingredientes elegidos">
          {picked.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                aria-label={`Quitar ${p.name}`}
                className="relative flex h-9 items-center gap-1.5 rounded-full bg-ink pl-3.5 pr-2.5 text-[14px] font-medium text-cream before:absolute before:inset-x-0 before:-inset-y-1"
              >
                {p.name}
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <div className="relative mt-3">
          <div className="flex h-11 items-center gap-2 rounded-full border border-border-soft bg-cream px-3.5 focus-within:border-ink">
            <Search size={16} className="shrink-0 text-ink-soft" aria-hidden="true" />
            <label htmlFor={inputId} className="sr-only">
              Buscar un ingrediente que tengas
            </label>
            <input
              id={inputId}
              type="text"
              role="combobox"
              aria-expanded={options.length > 0}
              aria-controls={listId}
              autoComplete="off"
              placeholder={picked.length === 0 ? "calabacín, huevo…" : "Añade otro"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-soft"
            />
          </div>
          {options.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Ingredientes"
              className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-64 overflow-y-auto rounded-[16px] border border-border-soft bg-paper py-1 shadow-lg"
            >
              {options.map((r) => (
                <li key={r.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => {
                      onAdd({ id: r.id, name: r.name })
                      setQuery("")
                    }}
                    className="flex min-h-11 w-full items-center px-4 text-left text-[15px] text-ink hover:bg-cream-deep"
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.length >= 2 && !isFetching && options.length === 0 && (
            <p className="mt-2 px-1 text-[13px] text-ink-soft">No encuentro ese ingrediente.</p>
          )}
        </div>
      )}
    </section>
  )
}
