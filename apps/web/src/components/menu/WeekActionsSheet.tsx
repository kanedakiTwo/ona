"use client"

/**
 * The week's "···" sheet on /menu (2026-10-08 redesign). Holds what used to
 * sit in the header and toolbar: week navigation (anterior / siguiente /
 * volver a esta semana), Regenerar semana, Compartir, Vaciar semana, the
 * Día/Semana view switch (mobile only) and the history link.
 * Past weeks are read-only: no Regenerar / Vaciar.
 */
import { CalendarDays, ChevronLeft, ChevronRight, History, LayoutList, RefreshCw, Share2, Trash2 } from "lucide-react"
import { MenuSheet, SheetAction } from "./MenuSheet"

interface Props {
  open: boolean
  onClose: () => void
  weekLabel: string
  weekRange: string
  isCurrentWeek: boolean
  isPastWeek: boolean
  hasMenu: boolean
  isGenerating: boolean
  viewMode: "day" | "week"
  /** The Día/Semana switch only exists below lg (desktop always shows both). */
  showViewToggle: boolean
  onPrevWeek: () => void
  onNextWeek: () => void
  onThisWeek: () => void
  onRegenerate: () => void
  onShare: () => void
  onClear: () => void
  onToggleView: () => void
}

export function WeekActionsSheet(p: Props) {
  const run = (fn: () => void) => () => {
    fn()
    p.onClose()
  }
  return (
    <MenuSheet open={p.open} onClose={p.onClose} eyebrow={p.weekRange} title="Tu semana">
      {/* Week navigation */}
      <div className="mb-3 flex items-center gap-1 rounded-full border border-border bg-paper p-1">
        <button
          type="button"
          onClick={p.onPrevWeek}
          aria-label="Semana anterior"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-ink"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="flex-1 text-center text-[14px] font-medium text-ink" aria-live="polite">
          {p.weekLabel}
        </span>
        <button
          type="button"
          onClick={p.onNextWeek}
          aria-label="Semana siguiente"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-ink"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="flex flex-col gap-0.5">
        {!p.isCurrentWeek && (
          <SheetAction icon={CalendarDays} label="Volver a esta semana" onClick={run(p.onThisWeek)} />
        )}
        {!p.isPastWeek && (
          <SheetAction
            icon={RefreshCw}
            label={p.isGenerating ? "Generando…" : "Regenerar semana"}
            hint="Los platos fijados se quedan"
            disabled={p.isGenerating}
            onClick={run(p.onRegenerate)}
          />
        )}
        {p.hasMenu && (
          <SheetAction icon={Share2} label="Compartir" hint="Tu menú como texto, con un enlace" onClick={run(p.onShare)} />
        )}
        {p.showViewToggle && (
          <SheetAction
            icon={LayoutList}
            label={p.viewMode === "day" ? "Vista semana" : "Vista día"}
            hint={p.viewMode === "day" ? "Los siete días de un vistazo; arrastra para mover platos" : "Un día con sus fotos"}
            onClick={run(p.onToggleView)}
          />
        )}
        <SheetAction icon={History} label="Historial" hint="Menús de semanas anteriores" href="/menu/history" />
        {!p.isPastWeek && p.hasMenu && (
          <div className="mt-1 border-t border-border-soft pt-1">
            <SheetAction
              icon={Trash2}
              label="Vaciar semana"
              hint="Borra los platos no fijados para rellenar a mano"
              destructive
              disabled={p.isGenerating}
              onClick={run(p.onClear)}
            />
          </div>
        )}
      </div>
    </MenuSheet>
  )
}
