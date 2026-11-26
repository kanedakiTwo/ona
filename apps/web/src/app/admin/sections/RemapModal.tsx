"use client"

/**
 * Remap modal — PATCH /ingredients/:id/remap refreshes the ingredient's
 * per-100 g nutrition from a USDA or a BEDCA entry, and the API recomputes
 * every recipe that uses it (PRO-1125).
 *
 *   - The best entry comes preselected: «Vale» applies it, «Buscar otra»
 *     opens the list and the manual search.
 *   - The manual search takes the automatic path: translated for USDA and in
 *     Spanish for BEDCA. Only ingredients: no FNDDS, no restaurant or
 *     prepared dishes (the API filters them).
 *   - Spanish translations on each USDA candidate (English shown as fine-print)
 *   - "Estimar con Mimoia" — last-resort Claude-powered per-100g estimate
 *     written directly to the ingredient row (POST /ingredients/:id/estimate-nutrition)
 */

import { useEffect, useMemo, useState } from "react"
import { Search, Sparkles, X } from "lucide-react"
import {
  useEstimateNutrition,
  useSuggestIngredient,
  type AutoCreateCandidate,
} from "@/hooks/useIngredients"
import { useRemapIngredient } from "@/hooks/useAdmin"
import { CandidateCard } from "@/components/recipes/IngredientCandidateCard"
import { useQueryClient } from "@tanstack/react-query"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"

/** The entry «Vale» applies: the first one with any value (BEDCA comes first). */
export function bestCandidate(candidates: readonly AutoCreateCandidate[]): AutoCreateCandidate | null {
  return candidates.find((c) => Object.values(c.per100g).some((v) => v > 0)) ?? candidates[0] ?? null
}

function useDebouncedString(value: string, ms: number): string {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function RemapModal({
  id,
  name,
  onClose,
}: {
  id: string
  name: string
  onClose: () => void
}) {
  const [searchInput, setSearchInput] = useState("")
  const debouncedSearch = useDebouncedString(searchInput, 300)
  const suggest = useSuggestIngredient(name, true, debouncedSearch || undefined)
  const remap = useRemapIngredient()
  const estimate = useEstimateNutrition(id)
  const queryClient = useQueryClient()

  const [pickedFdc, setPickedFdc] = useState<number | null>(null)
  const [pickedBedca, setPickedBedca] = useState<string | null>(null)
  const [estimated, setEstimated] = useState<EstimateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // «Buscar otra»: the list + manual search instead of the one proposal.
  const [browsing, setBrowsing] = useState(false)

  const candidates = suggest.data?.candidates ?? []
  const defaultPick = useMemo(() => bestCandidate(candidates), [candidates])

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
      const resp = await estimate.mutateAsync()
      // The shared `Ingredient` type doesn't currently model `salt`, but
      // the API row carries it. Read defensively so TS stays happy and
      // missing fields surface as 0.
      const row = resp.ingredient as unknown as Record<string, number | undefined>
      setEstimated({
        nutrition: {
          kcal: row.calories ?? 0,
          proteinG: row.protein ?? 0,
          carbsG: row.carbs ?? 0,
          fatG: row.fat ?? 0,
          fiberG: row.fiber ?? 0,
          saltG: row.salt ?? 0,
        },
      })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo estimar con Mimoia.",
      )
    }
  }

  function handleConfirm() {
    setError(null)
    if (estimated) {
      // The estimate route already wrote to the DB (and recomputed the
      // recipes). Just close + refresh.
      queryClient.invalidateQueries({ queryKey: ["curator"] })
      queryClient.invalidateQueries({ queryKey: ["ingredients"] })
      onClose()
      return
    }
    // USDA or BEDCA, same endpoint (the BEDCA path used to PATCH fields the
    // route doesn't take, and nothing changed).
    const source =
      pickedFdc != null ? { fdcId: pickedFdc } : pickedBedca != null ? { bedcaId: pickedBedca } : null
    if (!source) return
    remap.mutate(
      { id, ...source },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(err.message ?? "Error al re-mapear."),
      },
    )
  }

  const hasCandidates = candidates.length > 0
  const canConfirm =
    !!estimated || pickedFdc != null || pickedBedca != null
  // The single proposal until «Buscar otra».
  const proposing = !browsing && !estimated && !suggest.isLoading && defaultPick != null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Re-mapear ingrediente"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border-soft bg-cream p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-eyebrow text-terracotta-deep">Re-mapear ingrediente</div>
            <h3 className={`mt-1 ${DISPLAY_UI} text-[1.5rem] leading-tight text-ink`}>
              <span className="font-italic italic">&ldquo;{name}&rdquo;</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-1 text-ink-muted hover:bg-cream-deep hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {!proposing && (
          <div className="mt-4">
            <label
              htmlFor="remap-search"
              className="text-[10px] uppercase tracking-[0.12em] text-ink-muted"
            >
              Búsqueda manual
            </label>
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-border-soft bg-cream-deep px-3 py-2 focus-within:border-ink focus-within:ring-1 focus-within:ring-ink">
              <Search size={14} className="shrink-0 text-ink-muted" />
              <input
                id="remap-search"
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Busca otro nombre (en español o en inglés)…"
                className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink-muted focus:outline-none"
              />
            </div>
            {suggest.data?.queryUsed && (
              <p className="mt-1 text-[11px] italic text-ink-muted">
                En USDA: <span className="not-italic">&ldquo;{suggest.data.queryUsed}&rdquo;</span>
              </p>
            )}
          </div>
        )}

        {proposing && defaultPick && (
          <div className="mt-5">
            <p className="text-[13px] text-ink-mid">La ficha que mejor encaja:</p>
            <div className="mt-2">
              <CandidateCard candidate={defaultPick} picked onClick={() => selectCandidate(defaultPick)} />
            </div>
            <p className="mt-2 text-[12px] text-ink-muted">
              Al aplicarla se recalculan las recetas que usan este ingrediente.
            </p>
          </div>
        )}

        {suggest.isLoading && (
          <p className="mt-4 text-[13px] italic text-ink-muted">
            Buscando candidatos...
          </p>
        )}
        {suggest.isError && (
          <p className="mt-4 text-[13px] italic text-terracotta-deep">
            No se pudo consultar USDA. Prueba con otra búsqueda o estima con Mimoia.
          </p>
        )}

        {!proposing && !suggest.isLoading && hasCandidates && (
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
          <p className="mt-4 text-[13px] italic text-ink-muted">
            Sin coincidencias en USDA ni BEDCA para esta búsqueda.
          </p>
        )}

        {estimated && (
          <EstimatedSummary
            name={name}
            nutrition={estimated.nutrition}
            onRerun={runEstimate}
            isRerunning={estimate.isPending}
          />
        )}

        {error && (
          <p className="mt-4 text-[12px] italic text-terracotta-deep">{error}</p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={remap.isPending || !canConfirm}
            onClick={handleConfirm}
            className="rounded-full bg-ink px-5 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-cream transition-all hover:bg-ink-mid active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {remap.isPending
              ? "Aplicando..."
              : estimated
              ? "Cerrar (estimación guardada)"
              : proposing
              ? "Vale"
              : "Aplicar mapeo"}
          </button>
          {proposing && (
            <button
              type="button"
              disabled={remap.isPending}
              onClick={() => setBrowsing(true)}
              className="rounded-full border border-border-soft bg-transparent px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-ink-mid transition-all hover:border-ink hover:text-ink active:scale-95 disabled:opacity-40"
            >
              Buscar otra
            </button>
          )}
          {!proposing && (
            <button
              type="button"
              disabled={estimate.isPending || remap.isPending}
              onClick={runEstimate}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-transparent px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-ink-mid transition-all hover:border-ink hover:text-ink active:scale-95 disabled:opacity-40"
            >
              <Sparkles size={12} />
              {estimate.isPending ? "Estimando..." : "Estimar con Mimoia"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[12px] uppercase tracking-[0.12em] text-ink-muted hover:text-ink"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

interface EstimateResult {
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
  nutrition: EstimateResult["nutrition"]
  onRerun: () => void
  isRerunning: boolean
}) {
  return (
    <div className="mt-5 rounded-2xl border border-border-soft bg-cream-deep px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.12em] text-ink-muted">
          Estimación de Mimoia · &ldquo;{name}&rdquo;
        </div>
        <button
          type="button"
          onClick={onRerun}
          disabled={isRerunning}
          className="text-[11px] uppercase tracking-[0.12em] text-terracotta-deep underline hover:no-underline disabled:opacity-40"
        >
          {isRerunning ? "..." : "Reintentar"}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[12px] text-ink">
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
    <div className="rounded-md bg-cream px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </div>
      <div className="text-[13px] font-medium text-ink">{value}</div>
    </div>
  )
}
