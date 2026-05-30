"use client"

/**
 * "Vista semana" — alternative menu layout, second iteration.
 *
 * Changes vs. v1 (per Miguel's feedback after using it):
 *   - **Transposed**: days are rows now, meals are columns. Mobile portrait
 *     has more horizontal real estate per cell because there are 3 meals
 *     (or fewer) instead of 7 days.
 *   - **Meal columns are pruned**: if a meal type has zero recipes across
 *     the whole week, it doesn't render. So a household that never eats
 *     breakfast / merienda sees a 2-column grid instead of 4.
 *   - **Iconic meal headers**: Sunrise / Sun / Sunset / Moon icons instead
 *     of "Desayuno / Comida / Merienda / Cena" labels, which were eating
 *     header space.
 *   - **Short names**: the helper trims openers ("Cómo hacer", "Receta
 *     de", "Las 7 recetas que…") and word-truncates the rest so cells
 *     render the dish, not the SEO headline.
 *   - **Drag-and-drop between cells**: each filled cell is draggable;
 *     every cell (filled or empty) is a drop target. Drop = move; drop
 *     on occupied cell = swap. Backed by atomic `POST /menu/:id/move-slot`.
 */
import { useMemo } from "react"
import { motion } from "motion/react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { Sunrise, Sun, Sunset, Moon } from "lucide-react"
import type { DayMenu } from "@ona/shared"
import { shortRecipeName } from "@/lib/recipeView"
import { useState } from "react"

type MealKey = "breakfast" | "lunch" | "dinner" | "snack"

const DAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"]
const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

const ALL_MEALS: { key: MealKey; label: string; Icon: typeof Sunrise }[] = [
  { key: "breakfast", label: "Desayuno", Icon: Sunrise },
  { key: "lunch", label: "Comida", Icon: Sun },
  { key: "snack", label: "Merienda", Icon: Sunset },
  { key: "dinner", label: "Cena", Icon: Moon },
]

interface Props {
  days: DayMenu[]
  /** ISO YYYY-MM-DD Monday of the week — used to label day rows with dates. */
  weekStart: string
  /** 0–6 of today's row when within the displayed week, -1 otherwise. */
  todayIndex: number
  /** Tapping a cell switches the parent back to single-day view on this day. */
  onSelectDay: (dayIndex: number) => void
  /** Called when the user drops a cell onto another. The parent fires the
   *  move endpoint and lets React Query refetch the menu. */
  onMoveSlot?: (params: {
    fromDay: number
    fromMeal: MealKey
    toDay: number
    toMeal: MealKey
  }) => void
}

interface CellData {
  day: number
  meal: MealKey
  recipeId: string
  recipeName: string
  imageUrl: string | null
  isLeftover: boolean
}

export function WeekGridView({ days, weekStart, todayIndex, onSelectDay, onMoveSlot }: Props) {
  const start = new Date(weekStart + "T00:00:00")
  const dateOf = (i: number) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d.getDate()
  }

  // Skip meal columns that have zero recipes across the whole week.
  const visibleMeals = useMemo(() => {
    return ALL_MEALS.filter((m) =>
      days.some((day) => Boolean(day?.[m.key]?.recipeId)),
    )
  }, [days])

  // 8 px activation distance avoids drag-starts on a quick tap (which should
  // navigate to that day instead). Touch with 200 ms press-hold mirrors the
  // step-list sortable so the gesture is consistent across the app.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const [draggingCell, setDraggingCell] = useState<CellData | null>(null)

  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as CellData | undefined
    if (data) setDraggingCell(data)
  }

  function handleDragEnd(e: DragEndEvent) {
    setDraggingCell(null)
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

  // Grid columns: day-label gutter + N meal cols. Use a `--meals` CSS custom
  // property so the responsive widths share a single source of truth.
  const gridCols = `52px repeat(${visibleMeals.length}, minmax(0, 1fr))`

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="px-3 pb-8 md:px-5">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="overflow-hidden rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA]"
        >
          {/* Header row — meal icons */}
          <div
            className="grid border-b border-[#DDD6C5] bg-[#F2EDE0]"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div />
            {visibleMeals.map((m) => (
              <div
                key={m.key}
                className="flex flex-col items-center gap-1 border-l border-[#DDD6C5] py-2.5 text-[#7A7066]"
                title={m.label}
              >
                <m.Icon size={16} strokeWidth={1.6} />
                <span className="text-[8px] uppercase tracking-[0.18em] opacity-60 md:text-[9px]">
                  {m.label}
                </span>
              </div>
            ))}
          </div>

          {/* Day rows */}
          {DAY_SHORT.map((label, di) => {
            const isToday = di === todayIndex
            return (
              <div
                key={di}
                className="grid border-t border-[#DDD6C5] first:border-t-0"
                style={{ gridTemplateColumns: gridCols }}
              >
                <button
                  type="button"
                  onClick={() => onSelectDay(di)}
                  className={`flex flex-col items-center justify-center gap-0.5 bg-[#F2EDE0] py-2 transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] ${
                    isToday ? "text-[#C65D38]" : "text-[#1A1612]"
                  }`}
                  aria-label={`Ir a ${DAY_NAMES[di]}`}
                  title={DAY_NAMES[di]}
                >
                  <span className="text-[9px] uppercase tracking-[0.18em] opacity-70">
                    {label}
                  </span>
                  <span
                    className={`font-display text-[14px] leading-none md:text-[16px] ${
                      isToday ? "text-[#C65D38]" : ""
                    }`}
                  >
                    {dateOf(di)}
                  </span>
                </button>
                {visibleMeals.map((m) => {
                  const slot = days[di]?.[m.key]
                  const isPlanned = Boolean(slot?.recipeId)
                  const cellData: CellData | null = isPlanned
                    ? {
                        day: di,
                        meal: m.key,
                        recipeId: slot!.recipeId,
                        recipeName: slot!.recipeName ?? "Receta",
                        imageUrl: slot!.imageUrl ?? null,
                        isLeftover: slot!.kind === "leftover",
                      }
                    : null
                  return (
                    <DropCell
                      key={`${di}-${m.key}`}
                      dayIndex={di}
                      meal={m.key}
                      data={cellData}
                      onClick={() => onSelectDay(di)}
                    />
                  )
                })}
              </div>
            )
          })}
        </motion.div>

        <p className="mt-3 text-center text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
          Pulsa una celda para editar · arrastra para mover o intercambiar
        </p>
      </div>

      {/* Drag preview floats with the pointer; gives the user a clear sense
          that what they're dragging is the slot, not the cell. */}
      <DragOverlay>
        {draggingCell ? <CellPreview data={draggingCell} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

/** A drop target. When `data` is non-null the cell is also a drag source. */
function DropCell({
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
  const dropId = `cell-${dayIndex}-${meal}`
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId,
    data: { dayIndex, meal },
  })

  if (!data) {
    return (
      <button
        ref={setDropRef as unknown as React.LegacyRef<HTMLButtonElement>}
        type="button"
        onClick={onClick}
        className={`flex aspect-square items-center justify-center border-l border-[#DDD6C5] bg-transparent transition-colors md:aspect-auto md:min-h-[88px] ${
          isOver ? "bg-[#1A1612]/10" : "hover:bg-[#F2EDE0]"
        }`}
        aria-label="Slot vacío"
      >
        <span className="text-[#DDD6C5]">·</span>
      </button>
    )
  }

  return (
    <div
      ref={setDropRef}
      className={`relative border-l border-[#DDD6C5] ${
        isOver ? "ring-2 ring-inset ring-[#1A1612]/40" : ""
      }`}
    >
      <DraggableCell data={data} onClick={onClick} />
    </div>
  )
}

function DraggableCell({ data, onClick }: { data: CellData; onClick: () => void }) {
  const dragId = `cell-${data.day}-${data.meal}`
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
      onClick={(e) => {
        // Suppress the synthetic click motion fires immediately after a
        // drop, otherwise we'd both move the slot AND navigate.
        if (isDragging) return
        onClick()
      }}
      title={data.recipeName}
      className={`group relative flex w-full flex-col items-stretch overflow-hidden bg-[#FFFEFA] text-left transition-transform active:scale-[0.98] md:min-h-[88px] ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      {data.imageUrl ? (
        <div className="relative aspect-square w-full overflow-hidden md:aspect-[4/3]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.imageUrl}
            alt=""
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.04]"
            loading="lazy"
          />
          {data.isLeftover && (
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
      <span className="line-clamp-2 px-1.5 py-1 text-[10px] leading-tight text-[#1A1612] md:text-[11px]">
        {shortRecipeName(data.recipeName)}
      </span>
    </button>
  )
}

function CellPreview({ data }: { data: CellData }) {
  return (
    <div className="pointer-events-none w-[120px] overflow-hidden rounded-lg border border-[#1A1612]/30 bg-[#FFFEFA] shadow-[0_8px_24px_-8px_rgba(26,22,18,0.35)]">
      {data.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.imageUrl}
          alt=""
          className="aspect-[4/3] w-full object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center bg-[#F2EDE0]">
          <span className="font-display text-[1.6rem] text-[#C65D38]/30">∅</span>
        </div>
      )}
      <span className="line-clamp-2 px-1.5 py-1 text-[10px] leading-tight text-[#1A1612]">
        {shortRecipeName(data.recipeName)}
      </span>
    </div>
  )
}

function parseTargetId(id: string): { day: number; meal: MealKey } | null {
  // "cell-<day>-<meal>"
  const match = /^cell-(\d+)-(breakfast|lunch|dinner|snack)$/.exec(id)
  if (!match) return null
  return { day: Number(match[1]), meal: match[2] as MealKey }
}
