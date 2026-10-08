"use client"

/**
 * Day strip of /menu (Vista día): seven equal cells "L 5 · M 6 · X 7 …",
 * the selected day as an ink pill, today's number in terracotta when it
 * isn't selected, skipped days ("sin cocinar") muted.
 */
import { DAY_INITIALS, dateOfDay, weekdayName } from "@/lib/menuDay"

interface WeekStripProps {
  weekStart: string
  selectedDay: number
  todayIndex: number
  skippedDays?: number[]
  onSelectDay: (i: number) => void
}

export function WeekStrip({ weekStart, selectedDay, todayIndex, skippedDays = [], onSelectDay }: WeekStripProps) {
  return (
    <nav aria-label="Días de la semana" className="grid grid-cols-7 gap-1 px-4 pt-3">
      {DAY_INITIALS.map((initial, i) => {
        const date = dateOfDay(weekStart, i).getDate()
        const selected = i === selectedDay
        const today = i === todayIndex
        const skipped = skippedDays.includes(i)
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelectDay(i)}
            aria-pressed={selected}
            aria-current={today ? "date" : undefined}
            aria-label={`${weekdayName(i)} ${date}${today ? ", hoy" : ""}${skipped ? ", sin cocinar" : ""}`}
            className={`flex h-[54px] flex-col items-center justify-center gap-px rounded-2xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
              selected ? "bg-ink text-cream" : "text-ink-muted hover:bg-cream-deep"
            }`}
          >
            <span className="text-[11px] font-semibold">{initial}</span>
            <span
              className={`font-serif-text text-[19px] leading-none ${
                selected
                  ? "text-cream"
                  : skipped
                    ? "text-ink-light line-through decoration-1"
                    : today
                      ? "text-terracotta-deep"
                      : "text-ink"
              }`}
            >
              {date}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
