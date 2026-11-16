"use client"

/**
 * PRO-1233: the semana tipo in the empty slots of a week with no dishes yet
 * (`weekTypeHint`). /menu provides it only for such a week; the empty cells
 * of «La semana» (desktop and the mobile week view) and of the day view read
 * it and show, quietly, the icon and the name next to their «Añadir».
 */
import { createContext, useContext } from "react"
import type { Meal } from "@ona/shared"
import { DishTypeIcon } from "@/components/weekType/DishTypeIcon"
import type { WeekTypeHint } from "@/lib/weekTypeHint"

type HintFor = (day: number, meal: Meal) => WeekTypeHint | null

const WeekTypeHintContext = createContext<HintFor | null>(null)

export const WeekTypeHintProvider = WeekTypeHintContext.Provider

/** The hint of a slot, or null (a week with dishes, or nothing to say there). */
export function useWeekTypeHint(day: number, meal: string): WeekTypeHint | null {
  const hintFor = useContext(WeekTypeHintContext)
  return hintFor ? hintFor(day, meal as Meal) : null
}

/** Icon and name, in a muted ink; `stacked` puts the name under the icon (a narrow cell of «La semana»). */
export function WeekTypeHintLine({ hint, size = 16, stacked = false, className = "" }: { hint: WeekTypeHint; size?: number; stacked?: boolean; className?: string }) {
  return (
    <span
      data-testid="week-type-hint"
      className={`flex min-w-0 text-ink-light ${stacked ? "flex-col items-center gap-0.5 text-center" : "items-center gap-1.5"} ${className}`}
    >
      <DishTypeIcon type={hint.icon} size={size} />
      <span className={`min-w-0 max-w-full ${stacked ? "line-clamp-2 hyphens-auto leading-tight" : "truncate"}`} lang="es">
        {hint.label}
      </span>
    </span>
  )
}
