"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ShoppingBasket, Sparkles } from "lucide-react"
import type { AutoplanNotice } from "@ona/shared"
import { useAutoplanNotice, useAutoplanViewed } from "@/hooks/useAlerts"
import { useWeekType } from "@/hooks/useWeekType"
import { weekTypeConfigured } from "@/lib/blankWeek"

/**
 * Piloto automático (PRO-381, D-158; specs/menus.md): on Thursday Mimo left
 * next week done. On /menu, at the top, the card with the week's dates, then
 * «Ver la lista» and «Cambiar algo» (opens that week in the menu, `/menu?week=`;
 * Mimo until PRO-1180). With a semana tipo it says «Hecha con tu semana tipo».
 * On another week the dates open that week too. Opening that
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

/**
 * Whether the card wants to show (PRO-387: /menu shows one next step at a
 * time, lib/nextStep.ts). Lives in the page, so the week stamped on this
 * visit keeps its card while the picker re-renders.
 */
export function useAutoplanCard(weekStart: string) {
  const notice = useAutoplanNotice(true)
  // Kept for this visit: stamping the week clears the query, not the card on screen.
  const [kept, setKept] = useState<AutoplanNotice | null>(null)
  const [stamped, setStamped] = useState(false)
  useEffect(() => {
    if (notice.data && !kept) setKept(notice.data)
  }, [notice.data, kept])

  const onItsWeek = Boolean(kept && kept.weekStart === weekStart)
  // Once the week was opened, the card only stays on that week for this visit.
  const show = Boolean(kept) && (!stamped || onItsWeek)
  return { kept, onItsWeek, stamped, setStamped, show }
}

export function AutoplanCard({
  card,
  onOpenWeek,
}: {
  card: ReturnType<typeof useAutoplanCard>
  onOpenWeek: (weekStart: string) => void
}) {
  const { kept, onItsWeek, stamped, setStamped, show } = card
  const viewed = useAutoplanViewed()
  const weekType = useWeekType()
  // Stamped only once it is really on screen on its week.
  useEffect(() => {
    if (!kept || !onItsWeek || stamped) return
    setStamped(true)
    viewed.mutate(kept.weekStart)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, onItsWeek, stamped])

  if (!kept || !show) return null
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
      {weekTypeConfigured(weekType.data) && (
        <p data-testid="autoplan-week-type" className="mt-1 pl-[26px] text-[14px] text-ink-soft">
          Hecha con tu semana tipo
        </p>
      )}
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
          // PRO-1180: change it in the menu, not by asking Mimo.
          onClick={() => {
            onOpenWeek(kept.weekStart)
            window.scrollTo({ top: 0 })
          }}
          className="inline-flex min-h-[40px] items-center rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:border-ink"
        >
          Cambiar algo
        </button>
      </div>
    </section>
  )
}
