"use client"

import { createContext, useContext } from "react"
import { lineWeekLabel } from "@/lib/shoppingRange"

/**
 * PRO-269: when the list covers more than one week («Dos semanas», or the
 * ‹ › arrows), each line says which week it's for. The page provides
 * whether to show it and today's date; the row only renders the tag.
 */
export const LineWeekContext = createContext<{ show: boolean; today: string }>({ show: false, today: "" })

export function LineWeek({ weeks }: { weeks?: Record<string, number> | null }) {
  const { show, today } = useContext(LineWeekContext)
  if (!show) return null
  const label = lineWeekLabel(weeks, today)
  if (!label) return null
  return (
    <span
      data-testid="shopping-line-week"
      className="ml-2 whitespace-nowrap font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
    >
      {label}
    </span>
  )
}
