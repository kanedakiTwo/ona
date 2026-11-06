"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ShoppingBasket, Sparkles } from "lucide-react"
import type { AutoplanNotice } from "@ona/shared"
import { useMimo } from "@/components/mimo/MimoProvider"
import { useAutoplanNotice, useAutoplanViewed } from "@/hooks/useAlerts"

/**
 * Piloto automático (PRO-381, D-158; specs/menus.md): on Thursday Mimo left
 * next week done. On /menu, at the top, the card with the week's dates, then
 * «Ver la lista» and «Cambiar algo» (opens Mimo with «Quiero cambiar…»). On another week the dates open that week. Opening that
 * week stamps it (`POST /menu/autoplan/viewed`): the card stays for this
 * visit and doesn't come back. The API drops it after the week's Monday.
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
  const mimo = useMimo()
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
  return (
    <section
      data-testid="autoplan-card"
      aria-label="La semana, hecha por Mimo"
      className="mx-5 mt-3 rounded-2xl border border-border-soft bg-paper px-4 py-4 lg:mx-0"
    >
      <p className="flex items-start gap-2 font-serif-text text-[18px] font-[650] leading-snug text-ink">
        <Sparkles size={18} aria-hidden="true" className="mt-1 shrink-0 text-terracotta-deep" />
        <span>
          Mimo os ha dejado hecha la semana{" "}
          {onItsWeek ? (
            range
          ) : (
            <button
              type="button"
              data-testid="autoplan-open-week"
              onClick={() => onOpenWeek(kept.weekStart)}
              className="underline underline-offset-4 hover:text-terracotta-deep"
            >
              {range}
            </button>
          )}
        </span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href="/shopping"
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-ink px-4 text-[14px] font-semibold text-cream"
        >
          <ShoppingBasket size={16} aria-hidden="true" /> Ver la lista
        </Link>
        <button
          type="button"
          data-testid="autoplan-change"
          onClick={() => mimo.open({ draft: "Quiero cambiar " })}
          className="inline-flex min-h-[40px] items-center rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:border-ink"
        >
          Cambiar algo
        </button>
      </div>
    </section>
  )
}
