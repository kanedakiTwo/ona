"use client"

/**
 * PRO-1204: one quiet line on each day of the menu with what the household's
 * semana tipo asks for that day («Según tu semana: legumbres y cena fuera»),
 * linking to that day of /profile/semana-tipo. Never a check: a dish the
 * person changed is theirs, not an error. Nothing when the day asks for
 * nothing (every meal free).
 */
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { schoolWeekdays, weekTypeDayLine } from "@ona/shared"
import { useWeekType } from "@/hooks/useWeekType"
import { useSchoolMenu } from "@/hooks/useSchoolMenu"

export function WeekTypeDayLine({ weekStart, day, className = "" }: { weekStart: string; day: number; className?: string }) {
  const { data: days } = useWeekType()
  const school = useSchoolMenu()
  if (!days) return null
  const line = weekTypeDayLine(days, weekStart, day, school.data?.visible ? schoolWeekdays(school.data.days) : [])
  if (!line) return null
  return (
    <Link
      href={`/profile/semana-tipo?dia=${day}`}
      data-testid="week-type-day-line"
      className={`group flex min-h-[44px] items-center gap-1 text-[13px] leading-snug text-ink-muted hover:text-ink ${className}`}
    >
      <span className="min-w-0">
        Según tu semana: <span className="text-ink-mid group-hover:text-ink">{line}</span>
      </span>
      <ChevronRight size={14} aria-hidden="true" className="shrink-0" />
    </Link>
  )
}
