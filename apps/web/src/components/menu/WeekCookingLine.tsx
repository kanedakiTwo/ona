"use client"

import { minutesText, weekWorkMinutes } from "@ona/shared"

/**
 * D-1028 · «Esta semana: 2 h 40 min de cocina»: the cook's time of the week
 * on screen (the hands-on minutes of its dishes with a recipe; meals removed,
 * days marked «sin cocinar» and tápers add nothing). Nothing without data.
 */
export function WeekCookingLine({
  menu,
  className = "",
}: {
  /** `useMenu`'s legacy slot type predates `dishes`; the API sends the dish shape. */
  menu: { days: unknown; skippedDays?: number[] | null }
  className?: string
}) {
  const days = (Array.isArray(menu.days) ? menu.days : []) as Parameters<typeof weekWorkMinutes>[0]
  const minutes = weekWorkMinutes(days, menu.skippedDays ?? [])
  if (minutes == null || minutes <= 0) return null
  return (
    <p data-testid="menu-week-cooking" className={`text-[14px] leading-relaxed text-ink-muted ${className}`}>
      Esta semana: {minutesText(minutes)} de cocina
    </p>
  )
}
