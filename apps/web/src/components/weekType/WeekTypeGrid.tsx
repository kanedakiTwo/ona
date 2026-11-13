"use client"

/**
 * «Tu semana tipo» (D-182 §4): 7 days × the household's meals, one cell per
 * slot with an icon per option. One option fills the cell; two split it in
 * two; three or four, in four. Free slots say «Cualquier receta», the ones
 * switched off «no hay». Tapping a cell selects it for the slot panel.
 *
 * Without `onSelect` it is only a picture: the menu's skeleton while a week
 * is generated (PRO-1186), with what each slot takes that week (`weekStart`).
 */
import { MEALS, weekTypeOptionLabel, weekTypeOptionsFor, weekTypeSlotAt, weekTypeSlotView, type Meal, type WeekTypeDays, type WeekTypeSlotView } from "@ona/shared"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import { DishTypeIcon, iconOfOption } from "./DishTypeIcon"

export const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
const DAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"]
export const MEAL_NAMES: Record<Meal, string> = { breakfast: "desayuno", lunch: "comida", snack: "merienda", dinner: "cena" }

/** The grid's meals, in order: lunch and dinner always; breakfast and snack when some day has them (or `extra`). */
export function weekTypeMeals(days: WeekTypeDays | null | undefined, extra: readonly Meal[] = []): Meal[] {
  const order: Meal[] = ["breakfast", "lunch", "snack", "dinner"]
  const used = (m: Meal) => !!days && DAY_NAMES.some((_, d) => !weekTypeSlotAt(days, d, m).off)
  return order.filter((m) => (MEALS as readonly string[]).includes(m) && (m === "lunch" || m === "dinner" || used(m) || extra.includes(m)))
}

/** Pure: the slot as a cell shows it — all of it, or only what it takes the week of `weekStart`. */
function cellView(days: WeekTypeDays, d: number, meal: Meal, weekStart?: string): WeekTypeSlotView {
  const slot = weekTypeSlotAt(days, d, meal)
  if (!weekStart) return weekTypeSlotView(slot)
  return { off: !!slot.off, options: weekTypeOptionsFor(slot, weekStart), together: !!slot.together, every: 1 }
}

/** Pure: what a cell says to a screen reader («Viernes, cena: Pizza, cada 2 semanas»). */
export function cellLabel(days: WeekTypeDays, day: number, meal: Meal): string {
  const view = weekTypeSlotView(weekTypeSlotAt(days, day, meal))
  const what = view.off
    ? "no hay"
    : view.options.length === 0
      ? "cualquier receta"
      : `${view.options.map(weekTypeOptionLabel).join(", ")}${view.options.length > 1 ? (view.together ? " (juntos)" : " (por turnos)") : view.every > 1 ? `, cada ${view.every} semanas` : ""}`
  return `${DAY_NAMES[day]}, ${MEAL_NAMES[meal]}: ${what}`
}

export function WeekTypeGrid({
  days,
  meals,
  selected = null,
  onSelect,
  weekStart,
}: {
  days: WeekTypeDays
  meals: Meal[]
  selected?: { day: number; meal: Meal } | null
  /** Absent: a picture, nothing to tap (the menu's skeleton). */
  onSelect?: (day: number, meal: Meal) => void
  /** Show only what each slot takes that week (its turn), not all its options. */
  weekStart?: string
}) {
  // md+: like «La semana» of the menu — days in columns, meals in rows. Mobile: days in rows.
  const wide = useMediaQuery("(min-width: 768px)")
  const cell = (d: number, meal: Meal) => {
    const view = cellView(days, d, meal, weekStart)
    const isSel = selected?.day === d && selected?.meal === meal
    const quiet = view.off || view.options.length === 0
    const cls = `flex h-[88px] w-full min-w-0 items-center justify-center rounded-2xl p-1.5 text-left transition-colors md:h-[116px] md:p-1.5 ${
      quiet ? "border border-dashed border-border bg-transparent" : "border border-border-soft bg-paper"
    }`
    return (
      <div key={`${d}-${meal}`} role="gridcell" className="min-w-0">
        {onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(d, meal)}
            aria-label={cellLabel(days, d, meal)}
            aria-pressed={isSel}
            data-testid={`wt-cell-${d}-${meal}`}
            className={`${cls} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${quiet ? "hover:bg-cream-deep" : "hover:border-ink"} ${isSel ? "ring-2 ring-ink ring-offset-1 ring-offset-cream" : ""}`}
          >
            <CellContent view={view} />
          </button>
        ) : (
          <div data-testid={`wt-cell-${d}-${meal}`} className={`${cls} motion-safe:animate-pulse`}>
            <CellContent view={view} />
          </div>
        )}
      </div>
    )
  }
  const head = "pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted lg:text-[11px]"

  if (wide) {
    return (
      <div className="grid gap-2" style={{ gridTemplateColumns: "72px repeat(7, minmax(0, 1fr))" }} role="grid" aria-label="Tu semana tipo">
        <div role="row" className="contents">
          <div />
          {DAY_NAMES.map((name) => (
            <div key={name} role="columnheader" className="pb-1 text-center font-serif-text text-[15px] font-[650] text-ink">
              {name.slice(0, 3)}
            </div>
          ))}
        </div>
        {meals.map((meal) => (
          <div key={meal} role="row" className="contents">
            <div role="rowheader" className="flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {MEAL_NAMES[meal]}
            </div>
            {DAY_NAMES.map((_, d) => cell(d, meal))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `32px repeat(${meals.length}, minmax(0, 1fr))` }} role="grid" aria-label="Tu semana tipo">
      <div role="row" className="contents">
        <div />
        {meals.map((m) => (
          <div key={m} role="columnheader" className={head}>
            {MEAL_NAMES[m]}
          </div>
        ))}
      </div>
      {DAY_NAMES.map((dayName, d) => (
        <div key={d} role="row" className="contents">
          <div role="rowheader" className="flex items-center justify-center font-serif-text text-[15px] font-[650] text-ink" title={dayName}>
            {DAY_SHORT[d]}
          </div>
          {meals.map((meal) => cell(d, meal))}
        </div>
      ))}
    </div>
  )
}

function CellContent({ view }: { view: ReturnType<typeof weekTypeSlotView> }) {
  if (view.off) return <span className="text-[11px] text-ink-light md:text-[12px]">no hay</span>
  const n = view.options.length
  if (n === 0) {
    return (
      <span className="flex flex-col items-center gap-1 text-center text-ink-light">
        <DishTypeIcon type="any" size={20} />
        <span className="text-[10px] leading-tight md:text-[11.5px]">Cualquier receta</span>
      </span>
    )
  }
  if (n === 1) {
    const o = view.options[0]
    return (
      <span className="flex min-w-0 flex-col items-center gap-1 text-center text-ink">
        <DishTypeIcon type={iconOfOption(o)} size={24} />
        <span className="line-clamp-2 w-full hyphens-auto text-[10.5px] font-medium leading-tight md:text-[11.5px]" lang="es">{weekTypeOptionLabel(o)}</span>
        {view.every > 1 && <span className="text-[9.5px] leading-none text-terracotta-deep md:text-[11px]">Cada {view.every}</span>}
      </span>
    )
  }
  // Every option with its name: two in two halves, three or four in four
  // bands (a cell is ~80 px wide next to the panel: a 2×2 leaves no room for a name).
  return (
    <span className={`grid h-full w-full gap-0.5 ${n === 2 ? "grid-rows-2" : "grid-rows-4"}`}>
      {view.options.map((o, i) => (
        <span key={i} className={`flex min-w-0 items-center rounded-md bg-cream px-1 text-ink ${n === 2 ? "flex-col justify-center gap-0.5 text-center" : "gap-1"}`}>
          <DishTypeIcon type={iconOfOption(o)} size={n === 2 ? 14 : 11} />
          <span className={`min-w-0 max-w-full font-medium leading-tight ${n === 2 ? "block truncate text-[10px] md:line-clamp-2 md:whitespace-normal md:text-[10.5px]" : "block truncate text-[9px] md:text-[9.5px]"}`}>
            {weekTypeOptionLabel(o)}
          </span>
        </span>
      ))}
    </span>
  )
}
