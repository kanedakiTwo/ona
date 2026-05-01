"use client"

const DAY_LABELS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]

interface DayMeta {
  label: string
  date: number
  hasMenu: boolean
}

interface WeekStripProps {
  days: DayMeta[]
  selectedDay: number
  todayIndex: number
  onSelectDay: (i: number) => void
}

export function WeekStrip({
  days,
  selectedDay,
  todayIndex,
  onSelectDay,
}: WeekStripProps) {
  return (
    <div className="week-strip flex items-center justify-center gap-6 py-4 max-[479px]:justify-start max-[479px]:overflow-x-auto max-[479px]:scroll-smooth max-[479px]:[scroll-snap-type:x_mandatory]">
      {days.map((day, i) => {
        const isToday = i === todayIndex
        const isSelected = i === selectedDay
        const isDone = day.hasMenu

        return (
          <button
            key={i}
            onClick={() => onSelectDay(i)}
            className="flex flex-shrink-0 flex-col items-center gap-1.5 outline-none max-[479px]:[scroll-snap-align:start]"
          >
            {/* Day label */}
            <span
              className="text-[11px] font-medium uppercase tracking-[0.05em]"
              style={{
                color: isToday ? "#2D6A4F" : "var(--color-text-tertiary, #9ca3af)",
              }}
            >
              {day.label}
            </span>

            {/* Day circle */}
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-medium transition-all max-[479px]:h-9 max-[479px]:w-9"
              style={{
                ...getCircleStyles(isToday, isSelected, isDone),
              }}
            >
              {day.date}
            </div>

            {/* Status dot */}
            <div
              className="h-[5px] w-[5px] rounded-full"
              style={{
                background: isDone
                  ? "#97C459"
                  : isToday
                    ? "#2D6A4F"
                    : "var(--color-border-tertiary, #d1d5db)",
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

function getCircleStyles(
  isToday: boolean,
  isSelected: boolean,
  isDone: boolean
): React.CSSProperties {
  if (isToday && isSelected) {
    return {
      background: "#2D6A4F",
      border: "2px solid #2D6A4F",
      color: "white",
      outline: "2px solid #2D6A4F",
      outlineOffset: "2px",
    }
  }
  if (isToday) {
    return {
      background: "#2D6A4F",
      border: "2px solid #2D6A4F",
      color: "white",
    }
  }
  if (isSelected) {
    return {
      background: "var(--color-bg-secondary, #f3f4f6)",
      border: "2px solid var(--color-border-secondary, #9ca3af)",
      color: "var(--color-text-primary, #111827)",
    }
  }
  if (isDone) {
    return {
      background: "#EAF3DE",
      border: "2px solid #97C459",
      color: "#27500A",
    }
  }
  // Empty / default
  return {
    background: "white",
    border: "2px solid var(--color-border-tertiary, #d1d5db)",
    color: "var(--color-text-secondary, #6b7280)",
  }
}
