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
import { Plus, Search, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Ingredient } from "@ona/shared"
import {
  useAutoCreateIngredient,
  useEstimateNutritionPreview,
  useSearchIngredients,
  useSuggestIngredient,
} from "@/hooks/useIngredients"
import { CandidateCard } from "./IngredientCandidateCard"

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
  /**
   * Free-form text to show in the input when no `value` is selected — e.g.
   * the raw name returned by the photo/URL extractor for an ingredient that
   * didn't match the catalog. Lets the user see what the LLM tried so they
   * can confirm (via "Crear nuevo"), refine, or pick a similar existing row.
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
  const [modalName, setModalName] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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

function useDebouncedString(value: string, ms: number): string {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function AutoCreateModal({ name, onClose, onCreated }: ModalProps) {
  const [searchInput, setSearchInput] = useState("")
  const debouncedSearch = useDebouncedString(searchInput, 300)
  // When the curator types a refinement, send it through; otherwise let
  // the API run its own es→en translation.
  const suggest = useSuggestIngredient(name, true, debouncedSearch || undefined)
  const create = useAutoCreateIngredient()
  const previewEstimate = useEstimateNutritionPreview()

  // Picked source: USDA fdcId | BEDCA bedcaId | "estimated" (raw nutrition).
  const [pickedFdc, setPickedFdc] = useState<number | null>(null)
  const [pickedBedca, setPickedBedca] = useState<string | null>(null)
  const [estimated, setEstimated] = useState<
    EstimatedSnapshot | null
  >(null)
  const [error, setError] = useState<string | null>(null)

  const candidates = suggest.data?.candidates ?? []

  // Auto-pre-select the first Foundation/SR Legacy candidate when results
  // arrive. We never overwrite an explicit pick.
  const defaultPick = useMemo(() => {
    const top = candidates.find(
      (c) =>
        c.dataType === "Foundation" || c.dataType === "SR Legacy",
    )
    return top ?? candidates[0] ?? null
  }, [candidates])

  useEffect(() => {
    if (
      pickedFdc == null &&
      pickedBedca == null &&
      estimated == null &&
      defaultPick != null
    ) {
      if (defaultPick.fdcId != null) setPickedFdc(defaultPick.fdcId)
      else if (defaultPick.bedcaId != null) setPickedBedca(defaultPick.bedcaId)
    }
  }, [defaultPick, pickedFdc, pickedBedca, estimated])

  function selectCandidate(c: { fdcId: number | null; bedcaId: string | null }) {
    setEstimated(null)
    setPickedFdc(c.fdcId)
    setPickedBedca(c.bedcaId)
  }

  async function runEstimate() {
    setError(null)
    setEstimated(null)
    setPickedFdc(null)
    setPickedBedca(null)
    try {
      const resp = await previewEstimate.mutateAsync({ name })
      setEstimated({ nutrition: resp.nutrition })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo estimar con ONA.",
      )
    }
  }

  function handleConfirm(mode: "candidate" | "stub") {
    setError(null)
    if (mode === "stub") {
      // Skip nutrition entirely — legacy "Crear sin nutrición" path.
      create.mutate(
        { name, aisle: suggest.data?.suggestedAisle ?? null },
        {
          onSuccess: (resp) => onCreated(resp.ingredient),
          onError: (err) => setError(err.message ?? "Error al crear el ingrediente."),
        },
      )
      return
    }

    if (estimated) {
      create.mutate(
        {
          name,
          nutrition: estimated.nutrition,
          aisle: suggest.data?.suggestedAisle ?? null,
        },
        {
          onSuccess: (resp) => onCreated(resp.ingredient),
          onError: (err) =>
            setError(err.message ?? "Error al crear el ingrediente."),
        },
      )
      return
    }
    create.mutate(
      {
        name,
        fdcId: pickedFdc,
        bedcaId: pickedBedca,
        aisle: suggest.data?.suggestedAisle ?? null,
      },
      {
        onSuccess: (resp) => onCreated(resp.ingredient),
        onError: (err) =>
          setError(err.message ?? "Error al crear el ingrediente."),
      },
    )
  }

  const hasCandidates = candidates.length > 0
  const canConfirm =
    !!estimated || pickedFdc != null || pickedBedca != null

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
            <div className="text-eyebrow text-[#C65D38]">Sugerencias nutricionales</div>
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

        <div className="mt-4">
          <label
            htmlFor="auto-create-search"
            className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]"
          >
            Búsqueda manual
          </label>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 focus-within:border-[#1A1612] focus-within:ring-1 focus-within:ring-[#1A1612]">
            <Search size={14} className="shrink-0 text-[#7A7066]" />
            <input
              id="auto-create-search"
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Refina la búsqueda en USDA (en inglés)…"
              className="w-full bg-transparent text-[14px] text-[#1A1612] placeholder:text-[#7A7066] focus:outline-none"
            />
          </div>
          {suggest.data?.queryUsed && (
            <p className="mt-1 text-[11px] italic text-[#7A7066]">
              Buscando: <span className="not-italic">&ldquo;{suggest.data.queryUsed}&rdquo;</span>
            </p>
          )}
        </div>

        {suggest.isLoading && (
          <p className="mt-4 text-[13px] italic text-[#7A7066]">
            Buscando candidatos...
          </p>
        )}
        {suggest.isError && (
          <p className="mt-4 text-[13px] italic text-[#C65D38]">
            No se pudo consultar USDA. Prueba a estimar con ONA o crea sin
            nutrición.
          </p>
        )}

        {!suggest.isLoading && hasCandidates && (
          <ul className="mt-5 space-y-2">
            {candidates.map((c) => {
              const key = c.fdcId != null ? `fdc-${c.fdcId}` : `bedca-${c.bedcaId}`
              const picked =
                (c.fdcId != null && pickedFdc === c.fdcId) ||
                (c.bedcaId != null && pickedBedca === c.bedcaId)
              return (
                <li key={key}>
                  <CandidateCard
                    candidate={c}
                    picked={picked && !estimated}
                    onClick={() => selectCandidate(c)}
                  />
                </li>
              )
            })}
          </ul>
        )}

        {!suggest.isLoading && !hasCandidates && !suggest.isError && (
          <p className="mt-4 text-[13px] italic text-[#7A7066]">
            Sin coincidencias en USDA ni BEDCA. Estima con ONA o crea sin
            nutrición.
          </p>
        )}

        {estimated && (
          <EstimatedSummary
            name={name}
            nutrition={estimated.nutrition}
            onRerun={runEstimate}
            isRerunning={previewEstimate.isPending}
          />
        )}

        {error && (
          <p className="mt-4 text-[12px] italic text-[#C65D38]">{error}</p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={create.isPending || !canConfirm}
            onClick={() => handleConfirm("candidate")}
            className="rounded-full bg-[#1A1612] px-5 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {create.isPending
              ? "Creando..."
              : estimated
              ? "Crear con estimación"
              : "Crear con esta fuente"}
          </button>
          <button
            type="button"
            disabled={previewEstimate.isPending || create.isPending}
            onClick={runEstimate}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DDD6C5] bg-transparent px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-[#4A4239] transition-all hover:border-[#1A1612] hover:text-[#1A1612] active:scale-95 disabled:opacity-40"
          >
            <Sparkles size={12} />
            {previewEstimate.isPending ? "Estimando..." : "Estimar con ONA"}
          </button>
          <button
            type="button"
            disabled={create.isPending}
            onClick={() => handleConfirm("stub")}
            className="rounded-full border border-[#DDD6C5] bg-transparent px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-[#7A7066] transition-all hover:text-[#1A1612] active:scale-95 disabled:opacity-40"
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

interface EstimatedSnapshot {
  nutrition: {
    kcal: number
    proteinG: number
    carbsG: number
    fatG: number
    fiberG: number
    saltG: number
  }
}

function EstimatedSummary({
  name,
  nutrition,
  onRerun,
  isRerunning,
}: {
  name: string
  nutrition: EstimatedSnapshot["nutrition"]
  onRerun: () => void
  isRerunning: boolean
}) {
  return (
    <div className="mt-5 rounded-lg border border-[#2A5C8B] bg-[#EEF3FA] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#2A5C8B]">
          Estimación de ONA · &ldquo;{name}&rdquo;
        </div>
        <button
          type="button"
          onClick={onRerun}
          disabled={isRerunning}
          className="text-[11px] uppercase tracking-[0.12em] text-[#2A5C8B] underline hover:no-underline disabled:opacity-40"
        >
          {isRerunning ? "..." : "Reintentar"}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[12px] text-[#1A1612]">
        <NutritionStat label="kcal" value={Math.round(nutrition.kcal)} />
        <NutritionStat label="proteína" value={`${nutrition.proteinG.toFixed(1)} g`} />
        <NutritionStat label="hidratos" value={`${nutrition.carbsG.toFixed(1)} g`} />
        <NutritionStat label="grasa" value={`${nutrition.fatG.toFixed(1)} g`} />
        <NutritionStat label="fibra" value={`${nutrition.fiberG.toFixed(1)} g`} />
        <NutritionStat label="sal" value={`${nutrition.saltG.toFixed(2)} g`} />
      </div>
    </div>
  )
}

function NutritionStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-[#FAF6EE] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.12em] text-[#7A7066]">
        {label}
      </div>
      <div className="text-[13px] font-medium text-[#1A1612]">{value}</div>
    </div>
  )
}
