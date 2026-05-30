"use client"

/**
 * "Vista semana" — alternative menu layout that shows every slot at a
 * glance instead of one day at a time. Two responsive sizes:
 *
 *   - Mobile portrait (< md):  4 rows × 7 cols with 40 px thumbnails and a
 *                              one-line truncated title (option C of the
 *                              brainstorm).
 *   - >= md / landscape:       same grid but cells stretch to ~140 px,
 *                              two-line titles, optional time chip
 *                              (option D — desktop / tablet payoff).
 *
 * Tapping a cell calls `onSelectDay(dayIndex)`. The parent /menu page
 * uses that to flip back to "vista día" with that day selected, so the
 * grid is a pure navigation surface — no inline editing here.
 */
import { motion } from "motion/react"
import type { DayMenu } from "@ona/shared"

const DAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"]
const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
const MEAL_ROWS: { key: "breakfast" | "lunch" | "dinner" | "snack"; label: string; short: string }[] = [
  { key: "breakfast", label: "Desayuno", short: "Des" },
  { key: "lunch", label: "Comida", short: "Com" },
  { key: "dinner", label: "Cena", short: "Cen" },
  { key: "snack", label: "Snack", short: "Mer" },
]

interface Props {
  days: DayMenu[]
  /** ISO YYYY-MM-DD Monday of the week — used to label day cells with dates. */
  weekStart: string
  /** 0–6 of today's column when within the displayed week, -1 otherwise. */
  todayIndex: number
  /** Tapping a cell switches the parent back to single-day view on this day. */
  onSelectDay: (dayIndex: number) => void
}

export function WeekGridView({ days, weekStart, todayIndex, onSelectDay }: Props) {
  const start = new Date(weekStart + "T00:00:00")
  const dateOf = (i: number) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d.getDate()
  }

  return (
    <div className="px-3 pb-8 md:px-5">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="overflow-hidden rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA]"
      >
        {/* Column header: day labels */}
        <div className="grid grid-cols-[44px_repeat(7,1fr)] md:grid-cols-[88px_repeat(7,1fr)]">
          <div className="border-b border-[#DDD6C5] bg-[#F2EDE0]" />
          {DAY_SHORT.map((label, i) => {
            const isToday = i === todayIndex
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSelectDay(i)}
                className={`flex flex-col items-center gap-0.5 border-b border-l border-[#DDD6C5] bg-[#F2EDE0] py-2 transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] ${
                  isToday ? "text-[#C65D38]" : "text-[#1A1612]"
                }`}
                aria-label={`Ir a ${DAY_NAMES[i]}`}
              >
                <span className="text-[9px] uppercase tracking-[0.18em] opacity-70">{label}</span>
                <span className={`font-display leading-none ${isToday ? "text-[#C65D38]" : ""} text-[14px] md:text-[18px]`}>
                  {dateOf(i)}
                </span>
              </button>
            )
          })}
        </div>

        {/* Meal rows */}
        {MEAL_ROWS.map((meal, rowIdx) => (
          <div
            key={meal.key}
            className={`grid grid-cols-[44px_repeat(7,1fr)] md:grid-cols-[88px_repeat(7,1fr)] ${
              rowIdx < MEAL_ROWS.length - 1 ? "" : ""
            }`}
          >
            <div className="flex items-center justify-center border-r border-[#DDD6C5] bg-[#F2EDE0] py-2 md:py-3">
              <span className="text-[9px] uppercase tracking-[0.18em] text-[#7A7066] md:hidden">
                {meal.short}
              </span>
              <span className="hidden text-[11px] uppercase tracking-[0.15em] text-[#7A7066] md:inline">
                {meal.label}
              </span>
            </div>
            {days.map((day, di) => {
              const slot = day?.[meal.key]
              const isPlanned = !!slot?.recipeId
              const isLeftover = slot?.kind === "leftover"
              return (
                <WeekCell
                  key={di}
                  slot={slot}
                  isPlanned={isPlanned}
                  isLeftover={isLeftover}
                  onClick={() => onSelectDay(di)}
                />
              )
            })}
          </div>
        ))}
      </motion.div>

      <p className="mt-3 text-center text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
        Pulsa cualquier celda para editar ese plato
      </p>
    </div>
  )
}

function WeekCell({
  slot,
  isPlanned,
  isLeftover,
  onClick,
}: {
  slot?: { recipeId: string; recipeName?: string; imageUrl?: string | null } | undefined
  isPlanned: boolean
  isLeftover: boolean
  onClick: () => void
}) {
  if (!isPlanned) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group flex aspect-square items-center justify-center border-l border-t border-[#DDD6C5] bg-transparent transition-colors hover:bg-[#F2EDE0] md:aspect-auto md:min-h-[110px]"
        aria-label="Slot vacío — pulsa para añadir"
      >
        <span className="text-[#DDD6C5] transition-colors group-hover:text-[#7A7066]">·</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={slot?.recipeName ?? "Receta"}
      className="group relative flex flex-col items-stretch overflow-hidden border-l border-t border-[#DDD6C5] bg-[#FFFEFA] text-left transition-transform active:scale-[0.98] md:min-h-[110px]"
    >
      {/* Thumbnail layer */}
      {slot?.imageUrl ? (
        <div className="relative aspect-square w-full overflow-hidden md:aspect-[4/3]">
          {/* Plain img — external hosts (i.ytimg.com) and the API volume both serve raw bytes. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slot.imageUrl}
            alt=""
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.04]"
            loading="lazy"
          />
          {isLeftover && (
            <span className="absolute left-1 top-1 rounded-full bg-[#1A1612]/85 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.12em] text-[#FAF6EE]">
              Sobras
            </span>
          )}
        </div>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-[#F2EDE0] md:aspect-[4/3]">
          <span className="font-display text-[1.6rem] text-[#C65D38]/30">∅</span>
        </div>
      )}
      {/* Title — hidden on the tightest mobile cells, visible md+ */}
      <span className="hidden truncate px-2 py-1 text-[11px] leading-snug text-[#1A1612] md:line-clamp-2 md:block md:whitespace-normal">
        {slot?.recipeName ?? "Receta"}
      </span>
    </button>
  )
}

