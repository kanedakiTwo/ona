"use client"

import Link from "next/link"
import { CalendarDays, ChevronRight } from "lucide-react"
import { BRAND_NAME } from "@ona/shared"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"
import { useMonthMenu, type MonthMenu } from "@/hooks/useMonthMenu"

/** Pure: how many days of the month's menu have a dish. */
export function monthMenuDayCount(menu: Pick<MonthMenu, "days">): number {
  return menu.days.filter((d) => Object.values(d ?? {}).some((list) => (list?.length ?? 0) > 0)).length
}

/**
 * «Menú de <mes>» (PRO-378, specs/menus.md → «Menú del mes»): the card on
 * `/recipes` (signed in, nothing filtered) and on the blank week of `/menu`.
 * Opens the menu by days at `/menu/mes`; `weekStart` is the week the copy
 * goes to (the one the household is looking at). Nothing without a menu
 * this month.
 */
export function MonthMenuCard({ weekStart, className = "" }: { weekStart?: string; className?: string }) {
  const { data: menu } = useMonthMenu()
  if (!menu) return null
  const photos = menu.days.flatMap((d) => Object.values(d ?? {}).flat()).filter((r) => r?.imageUrl).slice(0, 3)
  const days = monthMenuDayCount(menu)
  return (
    <Link
      href={weekStart ? `/menu/mes?week=${weekStart}` : "/menu/mes"}
      data-testid="month-menu-card"
      className={`group flex items-center gap-4 rounded-[22px] border border-border bg-paper px-4 py-3.5 text-left text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-ink ${className}`}
    >
      {photos.length > 0 ? (
        <span className="flex shrink-0 -space-x-3" aria-hidden="true">
          {photos.map((r) => (
            <img key={r!.id} src={r!.imageUrl ?? ""} alt="" className="h-11 w-11 rounded-full border-2 border-paper object-cover" />
          ))}
        </span>
      ) : (
        <CalendarDays size={28} className="shrink-0 text-forest" aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        {/* #B5432A: terracotta darkened for small text on paper (AA). */}
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#B5432A]">De la cocina de {BRAND_NAME}</span>
        <span className={`${DISPLAY_UI} text-[20px] leading-[1.15]`}>{menu.title}</span>
        <span className="text-[13px] text-ink-soft">{days} días pensados para ti · cópialo a tu semana</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-soft transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  )
}
