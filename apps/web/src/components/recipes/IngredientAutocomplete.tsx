"use client"

/**
 * IngredientAutocomplete — replaces the closed datalist picker on /recipes/new.
 *
 * Behavior:
 *   - Debounced search against GET /ingredients?search=
 *   - Click a result → onSelect(ingredient)
 *   - When the search returns 0 results AND ≥ 2 chars typed, surface a
 *     "+ Crear nuevo ingrediente '{name}'" button at the bottom of the list
 *   - Clicking it opens the auto-create modal (USDA candidates +
 *     "Crear sin nutrición" fallback). On confirm we POST to
 *     /ingredients/auto-create and bubble the new ingredient up via onSelect.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Ingredient } from "@ona/shared"
import {
  useAutoCreateIngredient,
  useSearchIngredients,
  useSuggestIngredient,
  type AutoCreateCandidate,
} from "@/hooks/useIngredients"

interface Props {
  /** Currently-selected ingredient (controlled) */
  value: Ingredient | null
  /** Called when the user picks an existing ingredient OR auto-creates a new one */
  onSelect: (ing: Ingredient) => void
  /** Optional placeholder */
  placeholder?: string
  /** Marks the input border red */
  hasError?: boolean
  /** Stable id used for ARIA hooks (multiple rows on the page) */
  inputId?: string
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function IngredientAutocomplete({
  value,
  onSelect,
  placeholder,
  hasError,
  inputId,
}: Props) {
  const [query, setQuery] = useState(value?.name ?? "")
  const [open, setOpen] = useState(false)
  const [modalName, setModalName] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep input in sync if the parent swaps the selected ingredient.
  useEffect(() => {
    if (value && value.name !== query) {
      setQuery(value.name)
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const debounced = useDebounced(query, 200)
  const search = useSearchIngredients(debounced)

  const trimmed = query.trim()
  const showCreateOption =
    trimmed.length >= 2 &&
    !search.isLoading &&
    !(search.data ?? []).some(
      (ing) => ing.name.toLowerCase() === trimmed.toLowerCase()
    )

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
    onSelect(ing)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        id={inputId}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? "Ingrediente"}
        autoComplete="off"
        className={cn(
          "w-full rounded-lg border bg-[#F2EDE0] px-3 py-2 text-[14px] text-[#1A1612] placeholder:text-[#7A7066] focus:outline-none focus:ring-1",
          hasError
            ? "border-[#C65D38] focus:border-[#C65D38] focus:ring-[#C65D38]"
            : "border-[#DDD6C5] focus:border-[#1A1612] focus:ring-[#1A1612]"
        )}
      />

      {open && (search.data || search.isLoading || showCreateOption) && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-[#DDD6C5] bg-[#FAF6EE] py-1 shadow-md"
        >
          {search.isLoading && (
            <li className="px-3 py-2 text-[12px] italic text-[#7A7066]">
              Cargando...
            </li>
          )}
          {!search.isLoading &&
            (search.data ?? []).map((ing) => (
              <li key={ing.id}>
                <button
                  type="button"
                  onClick={() => pick(ing)}
                  className="block w-full px-3 py-2 text-left text-[14px] text-[#1A1612] hover:bg-[#F2EDE0]"
                >
                  {ing.name}
                </button>
              </li>
            ))}
          {showCreateOption && (
            <li className="border-t border-[#DDD6C5] mt-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  setModalName(trimmed)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-[#C65D38] hover:bg-[#F2EDE0]"
              >
                <Plus size={14} />
                Crear nuevo ingrediente
                <span className="font-italic italic text-[#1A1612]">
                  &ldquo;{trimmed}&rdquo;
                </span>
              </button>
            </li>
          )}
          {!search.isLoading &&
            (search.data ?? []).length === 0 &&
            !showCreateOption && (
              <li className="px-3 py-2 text-[12px] italic text-[#7A7066]">
                Empieza a escribir para buscar...
              </li>
            )}
        </ul>
      )}

      {modalName && (
        <AutoCreateModal
          name={modalName}
          onClose={() => setModalName(null)}
          onCreated={(ing) => {
            setModalName(null)
            pick(ing)
          }}
        />
      )}
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────

interface ModalProps {
  name: string
  onClose: () => void
  onCreated: (ing: Ingredient) => void
}

function AutoCreateModal({ name, onClose, onCreated }: ModalProps) {
  const suggest = useSuggestIngredient(name, true)
  const create = useAutoCreateIngredient()
  const [pickedFdc, setPickedFdc] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Auto-pre-select the first Foundation/SR Legacy candidate.
  const candidates = suggest.data?.candidates ?? []
  const defaultPick = useMemo(() => {
    const top = candidates.find(
      (c) => c.dataType === "Foundation" || c.dataType === "SR Legacy"
    )
    return top?.fdcId ?? candidates[0]?.fdcId ?? null
  }, [candidates])

  useEffect(() => {
    if (pickedFdc == null && defaultPick != null) {
      setPickedFdc(defaultPick)
    }
  }, [defaultPick, pickedFdc])

  function handleConfirm(stub: boolean) {
    setError(null)
    create.mutate(
      {
        name,
        fdcId: stub ? null : pickedFdc,
        aisle: suggest.data?.suggestedAisle ?? null,
      },
      {
        onSuccess: (resp) => {
          onCreated(resp.ingredient)
        },
        onError: (err) => {
          setError(err.message ?? "Error al crear el ingrediente.")
        },
      }
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crear nuevo ingrediente"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1612]/60 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#DDD6C5] bg-[#FAF6EE] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-eyebrow text-[#C65D38]">Sugerencias de USDA</div>
            <h3 className="mt-1 font-display text-[1.5rem] leading-tight text-[#1A1612]">
              Crear{" "}
              <span className="font-italic italic">&ldquo;{name}&rdquo;</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-1 text-[#7A7066] hover:bg-[#F2EDE0] hover:text-[#1A1612]"
          >
            <X size={18} />
          </button>
        </div>

        {suggest.isLoading && (
          <p className="mt-4 text-[13px] italic text-[#7A7066]">
            Buscando en USDA...
          </p>
        )}
        {suggest.isError && (
          <p className="mt-4 text-[13px] italic text-[#C65D38]">
            No se pudo consultar USDA. Puedes crear el ingrediente sin datos
            nutricionales.
          </p>
        )}

        {!suggest.isLoading && candidates.length > 0 && (
          <ul className="mt-5 space-y-2">
            {candidates.map((c) => (
              <li key={c.fdcId}>
                <button
                  type="button"
                  onClick={() => setPickedFdc(c.fdcId)}
                  className={cn(
                    "w-full rounded-lg border px-4 py-3 text-left transition-all",
                    pickedFdc === c.fdcId
                      ? "border-[#1A1612] bg-[#F2EDE0]"
                      : "border-[#DDD6C5] bg-[#FAF6EE] hover:border-[#1A1612]"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-[14px] font-medium text-[#1A1612]">
                        {c.description}
                      </div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#7A7066]">
                        Por 100 g · {Math.round(c.per100g.kcal)} kcal ·{" "}
                        {c.per100g.proteinG.toFixed(1)} g proteína
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]",
                        c.dataType === "Foundation"
                          ? "bg-[#2D6A4F] text-[#FAF6EE]"
                          : c.dataType === "SR Legacy"
                          ? "bg-[#C65D38] text-[#FAF6EE]"
                          : "bg-[#DDD6C5] text-[#1A1612]"
                      )}
                    >
                      Datos: {c.dataType.replace("Survey (FNDDS)", "FNDDS")}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!suggest.isLoading && candidates.length === 0 && !suggest.isError && (
          <p className="mt-4 text-[13px] italic text-[#7A7066]">
            Sin coincidencias en USDA. Puedes crear el ingrediente sin datos
            nutricionales — los rellenarás más tarde.
          </p>
        )}

        {error && (
          <p className="mt-4 text-[12px] italic text-[#C65D38]">{error}</p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={create.isPending || pickedFdc == null}
            onClick={() => handleConfirm(false)}
            className="rounded-full bg-[#1A1612] px-5 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {create.isPending ? "Creando..." : "Crear con USDA"}
          </button>
          <button
            type="button"
            disabled={create.isPending}
            onClick={() => handleConfirm(true)}
            className="rounded-full border border-[#DDD6C5] bg-transparent px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-[#4A4239] transition-all hover:border-[#1A1612] hover:text-[#1A1612] active:scale-95 disabled:opacity-40"
          >
            Crear sin nutrición
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[12px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
