"use client"

/**
 * «Cocinar esta» when the meal of now already had something planned
 * (specs/cook-now.md): move it to another day of the week (same meal) or
 * take it out. Closing the sheet counts as «Quitarlas».
 */
import { useState } from "react"
import { CalendarArrowUp, Trash2 } from "lucide-react"
import type { DisplaceTarget } from "@ona/shared"
import { MenuSheet, SheetAction } from "@/components/menu/MenuSheet"
import { weekdayName } from "@/lib/menuDay"

function listEs(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`
}

export function DisplaceSheet({
  open,
  plannedNames,
  today,
  targets,
  onChoose,
}: {
  open: boolean
  plannedNames: string[]
  /** Day index (0 = lunes) of the meal of now. */
  today: number
  targets: DisplaceTarget[]
  /** Day the planned dishes move to; null = take them out. */
  onChoose: (displacedTo: number | null) => void
}) {
  const [showDays, setShowDays] = useState(false)
  const article = plannedNames.length > 1 ? "las" : "el"
  const pronoun = plannedNames.length > 1 ? "las" : "lo"

  return (
    <MenuSheet
      open={open}
      onClose={() => onChoose(null)}
      eyebrow="Cocinar ahora"
      title={
        <>
          ¿Y {article} <span className="italic text-terracotta-deep">{listEs(plannedNames)}</span>?
        </>
      }
    >
      <SheetAction icon={CalendarArrowUp} label={`Pasar${pronoun} a otro día`} onClick={() => setShowDays((v) => !v)} />
      {showDays && (
        <ul className="mb-2 ml-11 space-y-1" aria-label="Días">
          {targets.map((t) => (
            <li key={t.day}>
              <button
                type="button"
                disabled={t.disabled}
                onClick={() => onChoose(t.day)}
                className="flex min-h-[44px] w-full flex-col justify-center rounded-xl px-3 text-left text-[15px] text-ink hover:bg-cream-deep disabled:cursor-not-allowed disabled:text-ink-light disabled:hover:bg-transparent"
              >
                <span>{t.day === today + 1 ? "Mañana" : `El ${weekdayName(t.day)}`}</span>
                <span className="text-[13px] text-ink-soft">
                  {t.replaces ? (
                    <>
                      en lugar de <span className="italic">{t.replaces}</span>
                    </>
                  ) : (
                    "libre"
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <SheetAction icon={Trash2} label={`Quitar${pronoun}`} destructive onClick={() => onChoose(null)} />
    </MenuSheet>
  )
}
