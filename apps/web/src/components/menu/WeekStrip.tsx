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
                color: isToday ? "#1A1612" : "#7A7066",
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
                  ? "#C65D38"
                  : isToday
                    ? "#1A1612"
                    : "#DDD6C5",
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
      background: "#1A1612",
      border: "2px solid #1A1612",
      color: "#FFFEFA",
      outline: "2px solid #1A1612",
      outlineOffset: "2px",
    }
  }
  if (isToday) {
    return {
      background: "#1A1612",
      border: "2px solid #1A1612",
      color: "#FFFEFA",
    }
  }
  if (isSelected) {
    return {
      background: "#F2EDE0",
      border: "2px solid #7A7066",
      color: "#1A1612",
    }
  }
  if (isDone) {
    return {
      background: "#F2EDE0",
      border: "2px solid #DDD6C5",
      color: "#4A4239",
    }
  }
  // Empty / default
  return {
    background: "#FFFEFA",
    border: "2px solid #DDD6C5",
    color: "#7A7066",
  }
}
