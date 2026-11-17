"use client"

/**
 * The week's "···" sheet on /menu (PRO-1179, propuesta
 * `2026-11-11-producto-hojas-del-menu.md` §1.7 y §3). First «Tu semana tipo»
 * (configure before asking for another draw), then the Día/Semana switch
 * (mobile only), Compartir, Imprimir and Historial; last, «Rehacer la
 * semana…», which opens a subsheet: «Con mi semana tipo» (POST
 * /menu/generate), «Solo con mis favoritas» (PRO-377) and «Vaciarla y
 * rellenar a mano» (destructive; the page asks first). Week navigation lives
 * in the header (‹ › and «volver a hoy»), not here. Past weeks can't be
 * redone. What shows when: `weekSheetOptions` (lib/weekSheet.ts).
 */
import { useEffect, useState } from "react"
import { CalendarRange, Heart, History, LayoutList, Printer, RefreshCw, RotateCcw, Share2, Trash2 } from "lucide-react"
import { WEEK_TYPE_HREF, weekSheetOptions } from "@/lib/weekSheet"
import { MenuSheet, SheetAction } from "./MenuSheet"

interface Props {
  open: boolean
  onClose: () => void
  weekRange: string
  /** 0 this week, > 0 a future one, < 0 a past one. */
  weeksFromNow: number
  hasMenu: boolean
  isGenerating: boolean
  viewMode: "day" | "week"
  /** lg+: no Día/Semana switch, and «Semana tipo» is the header button. */
  desktop: boolean
  /** «Con mi semana tipo»: rehace lo no fijado. */
  onRegenerate: () => void
  /** PRO-377: «Solo con mis favoritas». */
  onRegenerateFavorites: () => void
  onShare: () => void
  /** «Vaciarla y rellenar a mano»: the page confirms before clearing. */
  onClear: () => void
  onToggleView: () => void
  /** «Imprimir la semana» (PRO-112): /menu/imprimir?week=… */
  printHref: string
}

export function WeekActionsSheet(p: Props) {
  const [redoOpen, setRedoOpen] = useState(false)
  useEffect(() => {
    if (!p.open) setRedoOpen(false)
  }, [p.open])
  const { main, redo } = weekSheetOptions({ weeksFromNow: p.weeksFromNow, hasMenu: p.hasMenu, desktop: p.desktop })
  const has = (o: (typeof main)[number]) => main.includes(o)
  const run = (fn: () => void) => () => {
    fn()
    p.onClose()
  }
  return (
    <>
      <MenuSheet open={p.open && !redoOpen} onClose={p.onClose} eyebrow={p.weekRange} title="Tu semana" sheet="semana">
        <div className="flex flex-col gap-0.5" data-testid="week-sheet">
          {has("semana_tipo") && (
            <SheetAction
              icon={CalendarRange}
              label="Tu semana tipo"
              action="semana_tipo"
              hint="Qué coméis cada día; la próxima semana sale así"
              href={WEEK_TYPE_HREF}
              onClick={p.onClose}
            />
          )}
          {has("vista") && (
            <SheetAction
              icon={LayoutList}
              label={p.viewMode === "day" ? "Vista semana" : "Vista día"}
              action={p.viewMode === "day" ? "vista_semana" : "vista_dia"}
              hint={p.viewMode === "day" ? "Los siete días de un vistazo; arrastra para mover platos" : "Un día con sus fotos"}
              onClick={run(p.onToggleView)}
            />
          )}
          {has("compartir") && (
            <SheetAction icon={Share2} label="Compartir" action="compartir" hint="Tu menú como texto, con un enlace" onClick={run(p.onShare)} />
          )}
          {has("imprimir") && (
            <SheetAction icon={Printer} label="Imprimir la semana" action="imprimir" hint="En papel o en PDF, con la lista de la compra" href={p.printHref} />
          )}
          {has("historial") && (
            <SheetAction icon={History} label="Historial" action="historial" hint="Menús de semanas anteriores" href="/menu/history" />
          )}
          {has("rehacer") && (
            <div className="mt-1 border-t border-border-soft pt-1">
              <SheetAction
                icon={RotateCcw}
                label={p.isGenerating ? "Generando…" : "Rehacer la semana…"}
                action="rehacer"
                hint="Con tu semana tipo, con favoritas o vaciarla"
                disabled={p.isGenerating}
                onClick={() => setRedoOpen(true)}
              />
            </div>
          )}
        </div>
      </MenuSheet>

      <MenuSheet open={p.open && redoOpen} onClose={p.onClose} eyebrow={p.weekRange} title="Rehacer la semana" sheet="semana">
        <div className="flex flex-col gap-0.5" data-testid="week-redo-sheet">
          {redo.includes("regenerar") && (
            <SheetAction
              icon={RefreshCw}
              label="Con mi semana tipo"
              action="regenerar"
              hint="Lo que fijaste se queda"
              disabled={p.isGenerating}
              onClick={run(p.onRegenerate)}
            />
          )}
          {redo.includes("favoritas") && (
            <SheetAction
              icon={Heart}
              label="Solo con mis favoritas"
              action="favoritas"
              hint="Tus recetas guardadas, sin descubrir nuevas"
              disabled={p.isGenerating}
              onClick={run(p.onRegenerateFavorites)}
            />
          )}
          {redo.includes("vaciar") && (
            <div className="mt-1 border-t border-border-soft pt-1">
              <SheetAction
                icon={Trash2}
                label="Vaciarla y rellenar a mano"
                action="vaciar"
                hint="Borra los platos no fijados"
                destructive
                disabled={p.isGenerating}
                onClick={run(p.onClear)}
              />
            </div>
          )}
        </div>
      </MenuSheet>
    </>
  )
}
