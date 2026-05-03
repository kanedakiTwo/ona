"use client"

/**
 * Remap modal — reuses the auto-create modal's USDA picker UX, but on confirm
 * hits PATCH /ingredients/:id/remap to refresh the ingredient's fdcId and
 * per-100 g nutrition (rather than creating a new row).
 *
 * Adds:
 *   - Manual search box (curator can refine the query the API sends to USDA)
 *   - Spanish translations on each USDA candidate (English shown as fine-print)
 *   - BEDCA fallback when USDA returns nothing
 *   - "Estimar con ONA" — last-resort Claude-powered per-100g estimate
 *     written directly to the ingredient row (POST /ingredients/:id/estimate-nutrition)
 */

import { useEffect, useMemo, useState } from "react"
import { Search, Sparkles, X } from "lucide-react"
import {
  useEstimateNutrition,
  useSuggestIngredient,
} from "@/hooks/useIngredients"
import { useRemapIngredient } from "@/hooks/useAdmin"
import { CandidateCard } from "@/components/recipes/IngredientCandidateCard"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

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

  const candidates = suggest.data?.candidates ?? []
  const defaultPick = useMemo(() => {
    const top = candidates.find(
      (c) => c.dataType === "Foundation" || c.dataType === "SR Legacy",
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
        err instanceof Error ? err.message : "No se pudo estimar con ONA.",
      )
    }
  }

  async function handleConfirm() {
    setError(null)
    if (estimated) {
      // The estimate route already wrote to the DB. Just close + refresh.
      queryClient.invalidateQueries({ queryKey: ["curator"] })
      queryClient.invalidateQueries({ queryKey: ["ingredients"] })
      onClose()
      return
    }
    if (pickedFdc != null) {
      remap.mutate(
        { id, fdcId: pickedFdc },
        {
          onSuccess: () => onClose(),
          onError: (err) => setError(err.message ?? "Error al re-mapear."),
        },
      )
      return
    }
    if (pickedBedca != null) {
      // BEDCA persistence path: the existing /remap endpoint only takes an
      // fdcId, so we fall back to a direct PATCH that writes the per-100g
      // we already fetched on the client. Cleaner long-term would be a
      // dedicated /:id/remap-bedca endpoint, but PATCH covers it for now.
      const c = candidates.find((x) => x.bedcaId === pickedBedca)
      if (!c) return
      try {
        await api.patch(`/ingredients/${id}`, {
          calories: c.per100g.kcal,
          protein: c.per100g.proteinG,
          carbs: c.per100g.carbsG,
          fat: c.per100g.fatG,
          fiber: c.per100g.fiberG,
          salt: c.per100g.saltG,
        })
        queryClient.invalidateQueries({ queryKey: ["curator"] })
        queryClient.invalidateQueries({ queryKey: ["ingredients"] })
        onClose()
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo aplicar la fuente BEDCA.",
        )
      }
      return
    }
  }

  const hasCandidates = candidates.length > 0
  const canConfirm =
    !!estimated || pickedFdc != null || pickedBedca != null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Re-mapear ingrediente"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1612]/60 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#DDD6C5] bg-[#FAF6EE] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-eyebrow text-[#C65D38]">Re-mapear ingrediente</div>
            <h3 className="mt-1 font-display text-[1.5rem] leading-tight text-[#1A1612]">
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
            htmlFor="remap-search"
            className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]"
          >
            Búsqueda manual
          </label>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 focus-within:border-[#1A1612] focus-within:ring-1 focus-within:ring-[#1A1612]">
            <Search size={14} className="shrink-0 text-[#7A7066]" />
            <input
              id="remap-search"
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
            No se pudo consultar USDA. Prueba con otra búsqueda o estima con ONA.
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
          <p className="mt-4 text-[12px] italic text-[#C65D38]">{error}</p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={remap.isPending || !canConfirm}
            onClick={handleConfirm}
            className="rounded-full bg-[#1A1612] px-5 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {remap.isPending
              ? "Aplicando..."
              : estimated
              ? "Cerrar (estimación guardada)"
              : "Aplicar mapeo"}
          </button>
          <button
            type="button"
            disabled={estimate.isPending || remap.isPending}
            onClick={runEstimate}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DDD6C5] bg-transparent px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-[#4A4239] transition-all hover:border-[#1A1612] hover:text-[#1A1612] active:scale-95 disabled:opacity-40"
          >
            <Sparkles size={12} />
            {estimate.isPending ? "Estimando..." : "Estimar con ONA"}
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
