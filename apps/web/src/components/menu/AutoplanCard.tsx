"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ShoppingBasket, Sparkles } from "lucide-react"
import { autoplanHighlightLine, type AutoplanNotice } from "@ona/shared"
import { useAutoplanNotice, useAutoplanViewed } from "@/hooks/useAlerts"
import { useWeekType } from "@/hooks/useWeekType"
import { weekTypeConfigured } from "@/lib/blankWeek"

/**
 * Piloto automático (PRO-381, D-158; specs/menus.md): on Thursday Mimo left
 * next week done. On /menu, at the top, the card with the week's dates and
 * one real dish of it («El lunes cenáis …», PRO-1337, D-1029), then one
 * single action: on another week «Ver la semana, es un momento» (opens that
 * week in the menu, `/menu?week=`; Mimo until PRO-1180), on its own week
 * «Ver la lista». With a semana tipo it says «Hecha con tu semana tipo».
 * Opening that week stamps it (`POST /menu/autoplan/viewed`): the card stays
 * for this visit and doesn't come back. The API drops it after the week's Monday.
 */
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

/** Pure: «del 9 al 15 de noviembre» / «del 30 de noviembre al 6 de diciembre». */
export function autoplanRange(n: AutoplanNotice): string {
  const [, m1, d1] = n.weekStart.split("-").map(Number)
  const [, m2, d2] = n.weekEnd.split("-").map(Number)
  return m1 === m2
    ? `del ${d1} al ${d2} de ${MONTHS[m2 - 1]}`
    : `del ${d1} de ${MONTHS[m1 - 1]} al ${d2} de ${MONTHS[m2 - 1]}`
}

export function AutoplanCard({ weekStart, onOpenWeek }: { weekStart: string; onOpenWeek: (weekStart: string) => void }) {
  const notice = useAutoplanNotice(true)
  const viewed = useAutoplanViewed()
  const weekType = useWeekType()
  // Kept for this visit: stamping the week clears the query, not the card on screen.
  const [kept, setKept] = useState<AutoplanNotice | null>(null)
  const stamped = useRef(false)
  useEffect(() => {
    if (notice.data && !kept) setKept(notice.data)
  }, [notice.data, kept])

  const onItsWeek = Boolean(kept && kept.weekStart === weekStart)
  useEffect(() => {
    if (!kept || !onItsWeek || stamped.current) return
    stamped.current = true
    viewed.mutate(kept.weekStart)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, onItsWeek])

  // Once the week was opened, the card only stays on that week for this visit.
  if (!kept || (stamped.current && !onItsWeek)) return null
  const range = autoplanRange(kept)
  const dish = autoplanHighlightLine(kept.highlight)
  return (
    <section
      data-testid="autoplan-card"
      aria-label="La semana, hecha por Mimo"
      className="mx-5 mt-3 rounded-2xl border border-border-soft bg-paper px-4 py-4 lg:mx-0"
    >
      <p className="flex items-start gap-2 font-serif-text text-[18px] font-[650] leading-snug text-ink">
        <Sparkles size={18} aria-hidden="true" className="mt-1 shrink-0 text-terracotta-deep" />
        <span>Mimo os ha dejado hecha la semana {range}</span>
      </p>
      {dish && (
        <p data-testid="autoplan-dish" className="mt-1 pl-[26px] text-[15px] text-ink">
          {dish}
        </p>
      )}
      {weekTypeConfigured(weekType.data) && (
        <p data-testid="autoplan-week-type" className="mt-1 pl-[26px] text-[14px] text-ink-soft">
          Hecha con tu semana tipo
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onItsWeek ? (
          <Link
            href="/shopping"
            data-testid="autoplan-list"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-ink px-4 text-[14px] font-semibold text-cream"
          >
            <ShoppingBasket size={16} aria-hidden="true" /> Ver la lista
          </Link>
        ) : (
          <button
            type="button"
            data-testid="autoplan-change"
            // PRO-1180: the week opens in the menu, not by asking Mimo.
            onClick={() => {
              onOpenWeek(kept.weekStart)
              window.scrollTo({ top: 0 })
            }}
            className="inline-flex min-h-[40px] items-center rounded-full bg-ink px-4 text-[14px] font-semibold text-cream"
          >
            Ver la semana, es un momento
          </button>
        )}
      </div>
    </section>
  )
}
