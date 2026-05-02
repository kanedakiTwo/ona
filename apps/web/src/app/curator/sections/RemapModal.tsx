"use client"

/**
 * Remap modal — reuses the auto-create modal's USDA picker UX, but on confirm
 * hits PATCH /ingredients/:id/remap to refresh the ingredient's fdcId and
 * per-100 g nutrition (rather than creating a new row).
 */

import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import { useSuggestIngredient } from "@/hooks/useIngredients"
import { useRemapIngredient } from "@/hooks/useCurator"

export function RemapModal({
  id,
  name,
  onClose,
}: {
  id: string
  name: string
  onClose: () => void
}) {
  const suggest = useSuggestIngredient(name, true)
  const remap = useRemapIngredient()
  const [pickedFdc, setPickedFdc] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const candidates = suggest.data?.candidates ?? []
  const defaultPick = useMemo(() => {
    const top = candidates.find(
      (c) => c.dataType === "Foundation" || c.dataType === "SR Legacy",
    )
    return top?.fdcId ?? candidates[0]?.fdcId ?? null
  }, [candidates])

  useEffect(() => {
    if (pickedFdc == null && defaultPick != null) {
      setPickedFdc(defaultPick)
    }
  }, [defaultPick, pickedFdc])

  function handleConfirm() {
    if (pickedFdc == null) return
    setError(null)
    remap.mutate(
      { id, fdcId: pickedFdc },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(err.message ?? "Error al re-mapear."),
      },
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Re-mapear ingrediente a USDA"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1612]/60 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#DDD6C5] bg-[#FAF6EE] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-eyebrow text-[#C65D38]">Re-mapear a USDA</div>
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

        {suggest.isLoading && (
          <p className="mt-4 text-[13px] italic text-[#7A7066]">
            Buscando en USDA...
          </p>
        )}
        {suggest.isError && (
          <p className="mt-4 text-[13px] italic text-[#C65D38]">
            No se pudo consultar USDA.
          </p>
        )}

        {!suggest.isLoading && candidates.length > 0 && (
          <ul className="mt-5 space-y-2">
            {candidates.map((c) => (
              <li key={c.fdcId}>
                <button
                  type="button"
                  onClick={() => setPickedFdc(c.fdcId)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                    pickedFdc === c.fdcId
                      ? "border-[#1A1612] bg-[#F2EDE0]"
                      : "border-[#DDD6C5] bg-[#FAF6EE] hover:border-[#1A1612]"
                  }`}
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
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] ${
                        c.dataType === "Foundation"
                          ? "bg-[#2D6A4F] text-[#FAF6EE]"
                          : c.dataType === "SR Legacy"
                          ? "bg-[#C65D38] text-[#FAF6EE]"
                          : "bg-[#DDD6C5] text-[#1A1612]"
                      }`}
                    >
                      {c.dataType.replace("Survey (FNDDS)", "FNDDS")}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!suggest.isLoading && candidates.length === 0 && !suggest.isError && (
          <p className="mt-4 text-[13px] italic text-[#7A7066]">
            Sin coincidencias en USDA.
          </p>
        )}

        {error && (
          <p className="mt-4 text-[12px] italic text-[#C65D38]">{error}</p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={remap.isPending || pickedFdc == null}
            onClick={handleConfirm}
            className="rounded-full bg-[#1A1612] px-5 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {remap.isPending ? "Aplicando..." : "Aplicar mapeo"}
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
