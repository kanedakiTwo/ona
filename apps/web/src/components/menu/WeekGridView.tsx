"use client"

/**
 * "Vista semana" — scrollable list of every day, with each day's meals
 * stacked underneath as rows. Replaces the previous 2D grid because:
 *
 *   - The grid forced ~70 px cells on mobile; titles never fit.
 *   - Vertical-scroll-only feels more native on the phone.
 *   - DnD between rows is unambiguous: you grab a row, drop it onto
 *     another row, the two slots swap.
 *
 * Each row carries: thumbnail (or meal-icon placeholder), meal eyebrow
 * (icon + label), recipe name (long names auto-shortened via
 * `shortRecipeName`), and an optional time chip. Drop is allowed only on
 * rows whose `useDroppable` is `isOver` — `pointerWithin` collision
 * detection makes "drop on the margin / between rows" a no-op.
 *
 * Today's day block gets a soft terracotta tint + "HOY" pill so the
 * user lands on it when scrolling. Days the user marked "sin cocinar"
 * are still surfaced but with a muted state.
 *
 * Drops dispatch `ona:dnd-start` / `ona:dnd-end` window events so the
 * page-level `SwipeNavigator` knows to stand down for the gesture.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "motion/react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { CalendarX, ChevronRight, Moon, RotateCcw, Sun, Sunrise, Sunset, Utensils } from "lucide-react"
import type { DayMenu } from "@ona/shared"
import { shortRecipeName } from "@/lib/recipeView"

type MealKey = "breakfast" | "lunch" | "dinner" | "snack"

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
const DAY_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
]

const MEAL_META: Record<MealKey, { label: string; Icon: typeof Sun }> = {
  breakfast: { label: "Desayuno", Icon: Sunrise },
  lunch: { label: "Comida", Icon: Sun },
  snack: { label: "Merienda", Icon: Sunset },
  dinner: { label: "Cena", Icon: Moon },
}

const MEAL_ORDER: MealKey[] = ["breakfast", "lunch", "snack", "dinner"]

interface Props {
  days: DayMenu[]
  weekStart: string
  todayIndex: number
  /** Day indices the user marked "sin cocinar". Rendered as a muted block
   *  with an inline "Reactivar día" affordance so the user doesn't have to
   *  switch to the day view to clear the flag. */
  skippedDays?: number[]
  onSelectDay: (dayIndex: number) => void
  onMoveSlot?: (params: {
    fromDay: number
    fromMeal: MealKey
    toDay: number
    toMeal: MealKey
  }) => void
  /** Called when the user taps "Reactivar día" on a skipped block. */
  onUnskipDay?: (dayIndex: number) => void
}

interface CellData {
  day: number
  meal: MealKey
  recipeId: string
  recipeName: string
  imageUrl: string | null
  isLeftover: boolean
}

export function WeekGridView({
  days,
  weekStart,
  todayIndex,
  skippedDays,
  onSelectDay,
  onMoveSlot,
  onUnskipDay,
}: Props) {
  const start = new Date(weekStart + "T00:00:00")
  const skippedSet = useMemo(() => new Set(skippedDays ?? []), [skippedDays])

  // Meal types that have at least one recipe somewhere in the week —
  // empty-across-the-week meal types are dropped so the user doesn't see
  // 7 empty "Desayuno" rows when their household never plans breakfast.
  const visibleMeals = useMemo(() => {
    return MEAL_ORDER.filter((m) => days.some((day) => Boolean(day?.[m]?.recipeId)))
  }, [days])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const [draggingCell, setDraggingCell] = useState<CellData | null>(null)

  // On first mount, gently scroll today's block into view so the user lands
  // on "what am I cooking today" instead of starting at Monday every time.
  // Doing it after a paint avoids fighting the entry motion animation.
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (todayIndex < 0) return
    const id = setTimeout(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-day="${todayIndex}"]`,
      )
      el?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as CellData | undefined
    if (data) setDraggingCell(data)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("ona:dnd-start"))
    }
  }

  function endDrag() {
    setDraggingCell(null)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("ona:dnd-end"))
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    endDrag()
    if (!onMoveSlot || !e.over) return
    const from = e.active.data.current as CellData | undefined
    const to = parseTargetId(e.over.id as string)
    if (!from || !to) return
    if (from.day === to.day && from.meal === to.meal) return
    onMoveSlot({
      fromDay: from.day,
      fromMeal: from.meal,
      toDay: to.day,
      toMeal: to.meal,
    })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      <div ref={containerRef} className="px-3 pb-8 md:px-5">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA]"
        >
          {days.map((day, di) => (
            <DaySection
              key={di}
              dayIndex={di}
              date={dateOf(start, di)}
              monthLabel={monthOf(start, di)}
              dayShort={DAY_SHORT[di]}
              dayName={DAY_NAMES[di]}
              isToday={di === todayIndex}
              isSkipped={skippedSet.has(di)}
              visibleMeals={visibleMeals}
              day={day}
              onSelectDay={onSelectDay}
              onUnskipDay={onUnskipDay}
              isFirst={di === 0}
              isLast={di === days.length - 1}
            />
          ))}
        </motion.div>

        <p className="mt-3 text-center text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
          Pulsa para ir al día · arrastra una receta para moverla a otro slot
        </p>
      </div>

      <DragOverlay>
        {draggingCell ? <RowPreview data={draggingCell} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function DaySection({
  dayIndex,
  date,
  monthLabel,
  dayShort,
  dayName,
  isToday,
  isSkipped,
  visibleMeals,
  day,
  onSelectDay,
  onUnskipDay,
  isFirst,
  isLast,
}: {
  dayIndex: number
  date: number
  monthLabel: string
  dayShort: string
  dayName: string
  isToday: boolean
  isSkipped: boolean
  visibleMeals: MealKey[]
  day: DayMenu | undefined
  onSelectDay: (dayIndex: number) => void
  onUnskipDay?: (dayIndex: number) => void
  isFirst: boolean
  isLast: boolean
}) {
  const hasAnyMeal = visibleMeals.some((m) => Boolean(day?.[m]?.recipeId))
  // Background hierarchy:
  //   - skipped → muted cream so it visually recedes
  //   - today  → soft terracotta tint to anchor the eye
  //   - other  → plain card surface
  const sectionBg = isSkipped ? "bg-[#F2EDE0]/60" : isToday ? "bg-[#FDEEE8]" : ""
  // Sticky header inherits the section's background so it doesn't show
  // through to the rows it covers as the user scrolls. The card wrapper
  // no longer carries `overflow-hidden` (otherwise sticky would clip).
  const headerBg = isSkipped ? "bg-[#F2EDE0]" : isToday ? "bg-[#FDEEE8]" : "bg-[#FFFEFA]"

  return (
    <section
      data-day={dayIndex}
      className={`${isFirst ? "" : "border-t border-[#DDD6C5]"} ${sectionBg} ${
        isFirst ? "rounded-t-2xl" : ""
      } ${isLast ? "rounded-b-2xl" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSelectDay(dayIndex)}
        className={`sticky top-0 z-10 flex w-full items-center justify-between px-4 pt-3 pb-2 text-left backdrop-blur-sm ${headerBg}/95`}
        aria-label={`Ir al día ${dayName} ${date}`}
      >
        <div className="flex items-baseline gap-2">
          <span
            className={`text-[13px] font-medium ${
              isSkipped
                ? "text-[#7A7066]"
                : isToday
                  ? "text-[#C65D38]"
                  : "text-[#1A1612]"
            }`}
          >
            {dayShort} {date} {monthLabel}
          </span>
          {isToday && (
            <span className="rounded-full bg-[#C65D38] px-2 py-[1px] text-[9px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE]">
              Hoy
            </span>
          )}
          {isSkipped && (
            <span className="rounded-full border border-[#7A7066]/40 px-2 py-[1px] text-[9px] font-medium uppercase tracking-[0.12em] text-[#7A7066]">
              Sin cocinar
            </span>
          )}
        </div>
        <ChevronRight size={14} className="text-[#7A7066]" />
      </button>

      {isSkipped ? (
        <div className="flex items-center gap-2 px-4 pb-3 pt-1">
          <CalendarX size={14} className="text-[#7A7066]" />
          <span className="text-[12px] italic text-[#7A7066]">
            Día saltado en esta semana.
          </span>
          {onUnskipDay && (
            <button
              type="button"
              onClick={(e) => {
                // Stop propagation so the click doesn't also navigate via
                // the (parent isn't a button, but the section's day header
                // is — keep both behaviours independent).
                e.stopPropagation()
                onUnskipDay(dayIndex)
              }}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-[#1A1612] transition-colors hover:border-[#1A1612]"
            >
              <RotateCcw size={11} />
              Reactivar
            </button>
          )}
        </div>
      ) : (
        <div className="px-2 pb-2 md:px-3">
          {hasAnyMeal ? (
            visibleMeals.map((m) => {
              const slot = day?.[m]
              const isPlanned = Boolean(slot?.recipeId)
              const cellData: CellData | null = isPlanned
                ? {
                    day: dayIndex,
                    meal: m,
                    recipeId: slot!.recipeId,
                    recipeName: slot!.recipeName ?? "Receta",
                    imageUrl: slot!.imageUrl ?? null,
                    isLeftover: slot!.kind === "leftover",
                  }
                : null
              return (
                <SlotRow
                  key={m}
                  dayIndex={dayIndex}
                  meal={m}
                  data={cellData}
                  onClick={() => onSelectDay(dayIndex)}
                />
              )
            })
          ) : (
            // Truly empty days collapse to a single quiet line so they
            // don't take up the same vertical space as a populated day.
            <p className="px-2 py-1 text-[11px] italic text-[#A39A8E]">— sin platos —</p>
          )}
        </div>
      )}
    </section>
  )
}

function SlotRow({
  dayIndex,
  meal,
  data,
  onClick,
}: {
  dayIndex: number
  meal: MealKey
  data: CellData | null
  onClick: () => void
}) {
  const dropId = `row-${dayIndex}-${meal}`
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId,
    data: { dayIndex, meal },
  })
  const { label: mealLabel, Icon: MealIcon } = MEAL_META[meal]

  // Empty slot — still a drop target (drop moves a recipe in from elsewhere)
  // but no drag source.
  if (!data) {
    return (
      <button
        ref={setDropRef as unknown as React.LegacyRef<HTMLButtonElement>}
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
          isOver ? "bg-[#1A1612]/10" : "hover:bg-[#F2EDE0]"
        }`}
      >
        <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-lg border border-dashed border-[#DDD6C5] bg-[#F2EDE0]/40 text-[#7A7066]">
          <MealIcon size={18} strokeWidth={1.4} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
            <MealIcon size={12} strokeWidth={1.6} />
            {mealLabel}
          </p>
          <p className="mt-0.5 text-[13px] italic text-[#A39A8E]">Sin plato</p>
        </div>
      </button>
    )
  }

  return (
    <div ref={setDropRef} className={isOver ? "rounded-xl ring-2 ring-inset ring-[#1A1612]/40" : ""}>
      <DraggableRow data={data} onClick={onClick} mealLabel={mealLabel} MealIcon={MealIcon} />
    </div>
  )
}

function DraggableRow({
  data,
  onClick,
  mealLabel,
  MealIcon,
}: {
  data: CellData
  onClick: () => void
  mealLabel: string
  MealIcon: typeof Sun
}) {
  const dragId = `row-${data.day}-${data.meal}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data,
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => {
        if (isDragging) return
        onClick()
      }}
      className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
        isDragging ? "opacity-30" : "hover:bg-[#F2EDE0]"
      }`}
    >
      {/* Thumbnail — fall back to a meal icon when no image. */}
      <div className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-[#F2EDE0]">
        {data.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[#7A7066]">
            <Utensils size={20} strokeWidth={1.4} />
          </div>
        )}
        {data.isLeftover && (
          <span className="absolute bottom-0 left-0 right-0 bg-[#1A1612]/85 px-1 py-[1px] text-center text-[8px] font-medium uppercase tracking-[0.1em] text-[#FAF6EE]">
            Sobras
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="m-0 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
          <MealIcon size={12} strokeWidth={1.6} />
          {mealLabel}
        </p>
        <p
          className="mt-0.5 truncate text-[14px] font-medium text-[#1A1612]"
          title={data.recipeName}
        >
          {shortRecipeName(data.recipeName)}
        </p>
      </div>
      <ChevronRight size={16} className="shrink-0 text-[#7A7066]" />
    </button>
  )
}

function RowPreview({ data }: { data: CellData }) {
  const { Icon: MealIcon, label } = MEAL_META[data.meal]
  return (
    <div className="pointer-events-none w-[280px] rounded-xl border border-[#1A1612]/30 bg-[#FFFEFA] px-2 py-2 shadow-[0_8px_24px_-8px_rgba(26,22,18,0.35)]">
      <div className="flex items-center gap-3">
        <div className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-[#F2EDE0]">
          {data.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[#7A7066]">
              <Utensils size={20} strokeWidth={1.4} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
            <MealIcon size={12} strokeWidth={1.6} />
            {label}
          </p>
          <p className="mt-0.5 truncate text-[14px] font-medium text-[#1A1612]">
            {shortRecipeName(data.recipeName)}
          </p>
        </div>
      </div>
    </div>
  )
}

function dateOf(start: Date, i: number): number {
  const d = new Date(start)
  d.setDate(start.getDate() + i)
  return d.getDate()
}

function monthOf(start: Date, i: number): string {
  const d = new Date(start)
  d.setDate(start.getDate() + i)
  return MONTH_NAMES[d.getMonth()]
}

function parseTargetId(id: string): { day: number; meal: MealKey } | null {
  // "row-<day>-<meal>"
  const match = /^row-(\d+)-(breakfast|lunch|dinner|snack)$/.exec(id)
  if (!match) return null
  return { day: Number(match[1]), meal: match[2] as MealKey }
}
