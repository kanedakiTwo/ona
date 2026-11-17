"use client"

/**
 * «Sin plato todavía» (PRO-1177, E-72; propuesta de Producto
 * `2026-11-11-producto-hojas-del-menu.md` §1.3, §1.4 y §3): una sola hoja para
 * una comida sin plato (`vacio`: la tarjeta «Añadir plato», la celda «Añadir»
 * de «La semana», la fila vacía de la vista semana) y para una comida que el
 * día no tiene (`no_hay`: «El viernes no hay cena», la celda «no hay» y
 * «Añadir comida» del pie del día, tras elegir la comida). Qué opciones pinta
 * lo dice `noDishSheetOptions` (`lib/mealSheet.ts`):
 *
 *   - «Elegir receta»: el buscador con chips de tipo y «Que elija Mimoia»;
 *   - «Escribir un plato»: una nota («Pizza casera», «cenamos fuera»);
 *   - «Ya lo tengo hecho»: el buscador con los chips «Nevera» / «Congelador»
 *     (`variant: fridge` o `freezer`, no suma a la compra);
 *   - en el hueco vacío, «Quitar <comida> de este día» (con confirmación);
 *   - con la semana tipo, «¿Todos los <día>? Ponlo en tu semana tipo».
 *
 * Ya no hay «Fijar» (no protege nada en un hueco sin plato), ni «Una al azar»
 * suelta (es «Que elija Mimoia», dentro del buscador), ni «Del congelador» y
 * «Táper de la nevera» por separado.
 */
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { CalendarDays, Package, PenLine, Search, Trash2 } from "lucide-react"
import { noDishSheetOptions, weekTypeLinkLine, type NoDishWhere } from "@/lib/mealSheet"
import { mealLabel } from "@/lib/labels"
import { trackSheetAction } from "@/lib/usageEvents"
import { ConfirmSheet, MenuSheet, SheetAction } from "./MenuSheet"
import { RecipePickerSheet, type TaperPlace } from "./RecipePickerSheet"

export type NoDishSheet = null | "actions" | "picker" | "note" | "done" | "confirmRemove"

export interface NoDishHandlers {
  /** «Elegir receta» → una receta del buscador. */
  onPick: (recipeId: string) => void
  /** «Que elija Mimoia» (con el chip de tipo si lo hay). Rechaza si nada encaja: lo dice el buscador. */
  onPickAuto: (dishType: string | null) => Promise<unknown>
  /** «Escribir un plato» (y «Usar "<lo escrito>" como plato» del buscador). */
  onNote: (text: string) => void
  /** «Ya lo tengo hecho» → la receta, en la nevera o en el congelador. */
  onDone: (recipeId: string, place: TaperPlace) => void
  /** Solo el hueco vacío: «Quitar <comida> de este día». */
  onRemove?: () => void
}

export function NoDishSheets({
  open,
  setOpen,
  where,
  meal,
  day,
  eyebrow,
  pickerTitle,
  busy = false,
  showWeekTypeLink = false,
  onPick,
  onPickAuto,
  onNote,
  onDone,
  onRemove,
}: NoDishHandlers & {
  open: string | null
  setOpen: (next: NoDishSheet) => void
  where: NoDishWhere
  meal: string
  /** 0 = lunes: el «¿Todos los viernes?» del enlace a la semana tipo. */
  day: number
  /** «Cena · viernes 14». */
  eyebrow: string
  /** «Cena del viernes 14», the pickers' title. */
  pickerTitle: string
  /** Se está añadiendo una comida: no se puede elegir otra a la vez. */
  busy?: boolean
  showWeekTypeLink?: boolean
}) {
  const label = mealLabel(meal)
  const close = () => setOpen(null)
  const options = noDishSheetOptions({ where, hasWeekType: showWeekTypeLink })
  const has = (o: (typeof options)[number]) => options.includes(o)

  return (
    <>
      <MenuSheet open={open === "actions"} onClose={close} eyebrow={eyebrow} title="Sin plato todavía" sheet={where}>
        <div className="flex flex-col gap-0.5" data-testid="no-dish-sheet">
          <SheetAction
            icon={Search}
            label="Elegir receta"
            action="elegir_receta"
            hint="Busca, filtra por tipo o deja que elija Mimoia"
            disabled={busy}
            onClick={() => setOpen("picker")}
          />
          <SheetAction
            icon={PenLine}
            label="Escribir un plato"
            action="escribir_plato"
            hint="«Pizza casera», «cenamos fuera»"
            disabled={busy}
            onClick={() => setOpen("note")}
          />
          <SheetAction
            icon={Package}
            label="Ya lo tengo hecho"
            action="ya_hecho"
            hint="De la nevera o del congelador: no suma a la compra"
            disabled={busy}
            onClick={() => setOpen("done")}
          />
        </div>
        {has("quitar_comida") && onRemove && (
          <div className="mt-1 border-t border-border-soft pt-1">
            <SheetAction
              icon={Trash2}
              label={`Quitar ${label.toLowerCase()} de este día`}
              action="quitar_comida"
              hint={showWeekTypeLink ? "Solo este día. Para quitarla siempre, en tu semana tipo" : "Solo de este día; tus preferencias no cambian"}
              destructive
              onClick={() => setOpen("confirmRemove")}
            />
          </div>
        )}
        {has("semana_tipo") && (
          <Link
            href="/profile/semana-tipo"
            data-testid="no-dish-week-type"
            onClick={() => trackSheetAction(where, "semana_tipo")}
            className="mt-2 flex min-h-[44px] items-center gap-2 rounded-2xl px-3 text-[13.5px] text-ink-mid underline decoration-1 underline-offset-4 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            <CalendarDays size={15} strokeWidth={1.7} className="shrink-0" />
            {weekTypeLinkLine(day)}
          </Link>
        )}
      </MenuSheet>

      <NoteSheet
        open={open === "note"}
        onClose={close}
        eyebrow={eyebrow}
        onSave={(text) => {
          onNote(text)
          close()
        }}
      />

      {onRemove && (
        <ConfirmSheet
          open={open === "confirmRemove"}
          onClose={close}
          onConfirm={onRemove}
          eyebrow={eyebrow}
          title={`¿Quitar ${label.toLowerCase()} de este día?`}
          message={showWeekTypeLink ? "Solo este día. Para quitarla siempre, en tu semana tipo." : "Solo de este día; tus preferencias no cambian."}
          confirmLabel="Quitar"
        />
      )}

      {/* Out of the page's transformed wrappers, like the meal sheet's picker. */}
      {typeof document !== "undefined" &&
        createPortal(
          <>
            <RecipePickerSheet
              open={open === "picker"}
              onClose={close}
              title={pickerTitle}
              subtitle="Sin plato"
              onPick={(picked) => {
                onPick(picked.id)
                close()
              }}
              onUseText={(text) => {
                onNote(text)
                close()
              }}
              onPickAuto={async (dishType) => {
                trackSheetAction(where, "cambiar_azar")
                await onPickAuto(dishType)
                close()
              }}
            />
            <RecipePickerSheet
              open={open === "done"}
              onClose={close}
              taperChips
              title={pickerTitle}
              subtitle="Lo que ya tienes cocinado: no suma a la compra"
              onPick={(picked, place) => {
                const at = place ?? "fridge"
                trackSheetAction(where, at === "freezer" ? "congelador" : "taper_nevera")
                onDone(picked.id, at)
                close()
              }}
            />
          </>,
          document.body,
        )}
    </>
  )
}

/** «Escribir un plato»: lo que se come, sin receta (una nota de hasta 120 letras). */
function NoteSheet({
  open,
  onClose,
  eyebrow,
  onSave,
}: {
  open: boolean
  onClose: () => void
  eyebrow: string
  onSave: (text: string) => void
}) {
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setText("")
    // After MenuSheet moves the focus to its panel.
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [open])
  const value = text.trim()
  return (
    <MenuSheet open={open} onClose={onClose} eyebrow={eyebrow} title="Escribir un plato">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (value) onSave(value.slice(0, 120))
        }}
        className="flex flex-col gap-3"
      >
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 120))}
          placeholder="Pizza casera"
          aria-label="Qué vais a comer"
          className="min-h-[48px] w-full rounded-2xl border border-border bg-paper px-4 text-[16px] text-ink outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={!value}
          className="flex min-h-[48px] items-center justify-center rounded-full bg-ink px-4 text-[15px] font-semibold text-cream transition-colors hover:bg-forest disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Poner este plato
        </button>
      </form>
    </MenuSheet>
  )
}
