"use client"

/**
 * "Vista semana" (mobile, below lg; desktop uses MenuDesktop's «La semana»):
 * each day as a stacked section of meal rows.
 *
 *   - A sticky day header (tap = that day in Vista día).
 *   - Each row: thumbnail, meal eyebrow, every dish of the meal (a note edits
 *     in place), the semana tipo's chip and the time.
 *   - The row's "···" opens the meal sheet of Vista día (`MealOptionsSheets`)
 *     with the same `SlotContext` and `SlotHandlers` (`slotPropsFor`, built
 *     once by /menu for every view): PRO-1178, E-72. Until then the row had
 *     its own menu with other names («Aleatorio», «Bloquear», «Quitar slot»)
 *     and without Comensales, táper, sobras nor «Marcar como cocinada».
 *   - An empty row opens «Sin plato todavía», like Vista día: the slot's own
 *     sheet, or the «no hay» one when the day lacks that meal (`absentFor`).
 *   - Drag a row onto another to swap the two slots (`onMoveSlot`).
 *   - A recipe opens at the batch's servings, as from Vista día (PRO-75).
 *   - A past week shows no "···", «Sin plato todavía» nor «Reactivar», as
 *     Vista día; its notes still edit in place.
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
import { CalendarX, ChevronRight, Lock, Moon, RotateCcw, Sun, Sunrise, Sunset, Users } from "lucide-react"
import { weekTypeChipOf, type DayMenu, type Dish, type MealSlot, type RecipeDish } from "@ona/shared"
import { trackSheetAction } from "@/lib/usageEvents"
import { shortRecipeName } from "@/lib/recipeView"
import { NoteEditor } from "@/components/menu/NoteEditor"
import { RecipeCover } from "@/components/menu/RecipeCover"
import type { NoDishSheet } from "@/components/menu/NoDishSheets"
import { AbsentMealSheets, type AbsentMeals, type SlotPropsFn } from "@/components/menu/DayMeals"
import { MealOptionsButton, MealOptionsSheets, slotServings, useMealOptions } from "@/components/menu/MealOptions"

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
  skippedDays?: number[]
  /** A past week: no "···", «Sin plato todavía» nor «Reactivar» (as Vista día). */
  readOnly?: boolean
  /** The same slot context and handlers as Vista día (built once by /menu). */
  slotPropsFor: (day: number) => SlotPropsFn
  /** «Sin plato todavía» for a meal the day lacks, as Vista día's «no hay» card. */
  absentFor: (day: number) => Omit<AbsentMeals, "meals">
  onSelectDay: (dayIndex: number) => void
  /** Opens the recipe at the batch's servings (`slotServings`, as Vista día). */
  onSelectRecipe: (recipeId: string, servings: number) => void
  onMoveSlot?: (params: {
    fromDay: number
    fromMeal: MealKey
    toDay: number
    toMeal: MealKey
  }) => void
  onUnskipDay?: (dayIndex: number) => void
}

type RowProps = Pick<Props, "readOnly" | "slotPropsFor" | "absentFor" | "onSelectDay" | "onSelectRecipe">

interface CellData {
  day: number
  meal: MealKey
  recipeId: string
  recipeName: string
  imageUrl: string | null
  isLeftover: boolean
  totalMinutes: number | null
}

export function WeekGridView({
  days,
  weekStart,
  todayIndex,
  skippedDays,
  onMoveSlot,
  onUnskipDay,
  ...row
}: Props) {
  const start = new Date(weekStart + "T00:00:00")
  const skippedSet = useMemo(() => new Set(skippedDays ?? []), [skippedDays])

  // Meal types that have at least one *template-active* slot somewhere in
  // the week. Counts slot KEYS (not dish content) so empty-mode menus
  // still show the user's configured template slots as tappable "+ Añadir"
  // rows instead of collapsing to "— sin platos —".
  const visibleMeals = useMemo(() => {
    return MEAL_ORDER.filter((m) => days.some((day) => day?.[m] != null))
  }, [days])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const [draggingCell, setDraggingCell] = useState<CellData | null>(null)

  // On first mount, gently scroll today's block into view so the user lands
  // on "what am I cooking today" instead of starting at Monday every time.
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
              isToday={di === todayIndex}
              isSkipped={skippedSet.has(di)}
              visibleMeals={visibleMeals}
              day={day}
              onUnskipDay={onUnskipDay}
              isFirst={di === 0}
              isLast={di === days.length - 1}
              {...row}
            />
          ))}
        </motion.div>

        <p className="mt-3 text-center text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
          Pulsa para ir al día · arrastra una receta para moverla a otra comida
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
  isToday,
  isSkipped,
  visibleMeals,
  day,
  onUnskipDay,
  isFirst,
  isLast,
  ...row
}: RowProps & {
  dayIndex: number
  date: number
  monthLabel: string
  isToday: boolean
  isSkipped: boolean
  visibleMeals: MealKey[]
  day: DayMenu | undefined
  onUnskipDay?: (dayIndex: number) => void
  isFirst: boolean
  isLast: boolean
}) {
  const hasAnyMeal = visibleMeals.some((m) => day?.[m] != null)
  const sectionBg = isSkipped ? "bg-[#F2EDE0]/60" : isToday ? "bg-[#FDEEE8]" : ""
  const headerBg = isSkipped ? "bg-[#F2EDE0]" : isToday ? "bg-[#FDEEE8]" : "bg-[#FFFEFA]"

  return (
    <section
      data-day={dayIndex}
      className={`${sectionBg} ${!isFirst ? "border-t border-[#DDD6C5]" : "rounded-t-2xl"} ${isLast ? "rounded-b-2xl" : ""}`}
    >
      {/* Sticky header: tap flips to Vista día on that day. */}
      <button
        type="button"
        onClick={() => row.onSelectDay(dayIndex)}
        className={`sticky top-0 z-10 flex w-full items-center justify-between px-4 pt-3 pb-2 text-left backdrop-blur-sm ${headerBg}/95`}
        aria-label={`Ir al día ${DAY_NAMES[dayIndex]} ${date}`}
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={`whitespace-nowrap text-[13px] font-medium ${
              isSkipped
                ? "text-[#7A7066]"
                : isToday
                  ? "text-[#C65D38]"
                  : "text-[#1A1612]"
            }`}
          >
            {DAY_SHORT[dayIndex]} {date} {monthLabel}
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
          {onUnskipDay && !row.readOnly && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                trackSheetAction("dia", "reactivar_dia")
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
            visibleMeals.map((m) => (
              <SlotRow key={m} dayIndex={dayIndex} meal={m} slot={day?.[m] as MealSlot | undefined} {...row} />
            ))
          ) : (
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
  slot,
  readOnly,
  slotPropsFor,
  absentFor,
  onSelectDay,
  onSelectRecipe,
}: RowProps & {
  dayIndex: number
  meal: MealKey
  /** Undefined: the day doesn't have this meal («no hay»). */
  slot: MealSlot | undefined
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `row-${dayIndex}-${meal}`,
    data: { dayIndex, meal },
  })
  const ctl = useMealOptions()
  const [absentSheet, setAbsentSheet] = useState<NoDishSheet>(null)
  const { label: mealLabel, Icon: MealIcon } = MEAL_META[meal]
  const dayName = DAY_NAMES[dayIndex].toLowerCase()
  const props = slot ? slotPropsFor(dayIndex)(meal, slot) : null
  const sheets = !readOnly && props && <MealOptionsSheets ctl={ctl} {...props} />

  const dishes: Dish[] = slot?.dishes ?? []
  const firstRecipe = dishes.find((d): d is RecipeDish => d.kind === "recipe") ?? null

  // Empty row: the same sheet as Vista día's empty card («Sin plato todavía»,
  // PRO-1177), or its «no hay» card when the day lacks the meal.
  if (!props || dishes.length === 0) {
    return (
      <>
        <button
          ref={setDropRef as unknown as React.LegacyRef<HTMLButtonElement>}
          type="button"
          data-week-row={`${dayIndex}-${meal}`}
          onClick={() => {
            if (readOnly) onSelectDay(dayIndex)
            else if (props) ctl.setOpen("actions")
            else setAbsentSheet("actions")
          }}
          aria-haspopup={readOnly ? undefined : "dialog"}
          aria-label={readOnly ? undefined : `${mealLabel} del ${dayName}: añadir`}
          className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
            isOver ? "bg-[#1A1612]/10" : "hover:bg-[#F2EDE0]"
          }`}
        >
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-lg border border-dashed border-[#DDD6C5] bg-[#F2EDE0]/40 text-[#A39A8E]">
            <MealIcon size={18} strokeWidth={1.3} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
              <MealIcon size={12} strokeWidth={1.6} />
              {mealLabel}
            </p>
            <p className="mt-0.5 text-[13px] italic text-[#A39A8E]">{readOnly ? "Sin plato" : "+ Añadir"}</p>
          </div>
        </button>
        {sheets}
        {!readOnly && !slot && (
          <AbsentMealSheets open={absentSheet} setOpen={setAbsentSheet} meal={meal} {...absentFor(dayIndex)} />
        )}
      </>
    )
  }

  const { ctx, handlers } = props
  // Drag preview uses the first recipe dish; a note-only slot renders but
  // doesn't drag (no recipeId to carry).
  const cellData: CellData | null = firstRecipe
    ? {
        day: dayIndex,
        meal,
        recipeId: firstRecipe.recipeId,
        recipeName: firstRecipe.recipeName ?? "Receta",
        imageUrl: firstRecipe.imageUrl ?? null,
        isLeftover: firstRecipe.variant === "leftover",
        totalMinutes: firstRecipe.totalTime ?? firstRecipe.prepTime ?? null,
      }
    : null

  return (
    <>
      <div ref={setDropRef} data-week-row={`${dayIndex}-${meal}`} className={`relative ${isOver ? "rounded-xl ring-2 ring-inset ring-[#1A1612]/40" : ""}`}>
        <FilledRow
          dayIndex={dayIndex}
          meal={meal}
          mealLabel={mealLabel}
          MealIcon={MealIcon}
          dishes={dishes}
          firstRecipe={firstRecipe}
          cellData={cellData}
          isLocked={ctx.isLocked}
          // A leftover is part of its source batch: no «N pax» chip (PRO-75).
          servingsOverride={firstRecipe?.variant === "leftover" ? null : ctx.slot.servings ?? null}
          menuButton={
            readOnly ? null : (
              <MealOptionsButton
                ctl={ctl}
                label={`Más opciones de ${mealLabel.toLowerCase()} del ${dayName}`}
                className="-my-3 -mr-1 text-ink-mid"
              />
            )
          }
          onSelectDay={onSelectDay}
          onSelectRecipe={(recipeId) => onSelectRecipe(recipeId, slotServings(ctx))}
          onEditNote={handlers.editNote}
          onRemoveDish={handlers.removeDish}
        />
      </div>
      {/* The sheets live outside the card: React events bubble out of their
          portals, and the card's click opens the recipe and its pointer drags. */}
      {sheets}
    </>
  )
}

function FilledRow({
  dayIndex,
  meal,
  mealLabel,
  MealIcon,
  dishes,
  firstRecipe,
  cellData,
  isLocked,
  servingsOverride,
  menuButton,
  onSelectDay,
  onSelectRecipe,
  onEditNote,
  onRemoveDish,
}: {
  dayIndex: number
  meal: MealKey
  mealLabel: string
  MealIcon: typeof Sun
  dishes: Dish[]
  firstRecipe: RecipeDish | null
  cellData: CellData | null
  isLocked: boolean
  servingsOverride: number | null
  /** The "···" that opens the meal sheet (none on a past week). */
  menuButton: React.ReactNode
  onSelectDay: (dayIndex: number) => void
  onSelectRecipe: (recipeId: string) => void
  onEditNote: (position: number, text: string) => void
  onRemoveDish: (position: number) => void
}) {
  // The whole card is the drag handle (the first recipe carries the payload).
  const dragId = cellData ? `row-${dayIndex}-${meal}` : `noop-${dayIndex}-${meal}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: cellData ?? { day: dayIndex, meal, isPlaceholder: true },
    disabled: cellData == null,
  })
  // PRO-1186: «Legumbres · semana tipo», short, as the desktop cell.
  const weekType = weekTypeChipOf(dishes)

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if (isDragging) return
        const target = e.target as HTMLElement
        // The "···" and the dishes manage their own clicks.
        if (target.closest('[data-row-menu="1"]')) return
        if (target.closest('[data-dish-row="1"]')) return
        // Default: tap the card → recipe detail (first recipe) or day flip.
        if (firstRecipe) onSelectRecipe(firstRecipe.recipeId)
        else onSelectDay(dayIndex)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          if (!isDragging) {
            if (firstRecipe) onSelectRecipe(firstRecipe.recipeId)
            else onSelectDay(dayIndex)
          }
        }
      }}
      className={`relative flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
        isDragging ? "opacity-30" : "hover:bg-[#F2EDE0]"
      }`}
    >
      <div className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-[#F2EDE0]">
        <RecipeCover
          src={firstRecipe?.imageUrl}
          name={firstRecipe?.recipeName ?? mealLabel}
          meal={meal}
          className="h-full w-full"
        />
        {(firstRecipe?.variant === "leftover" || firstRecipe?.variant === "cooked") && (
          <span className="absolute bottom-0 left-0 right-0 bg-[#1A1612]/85 px-1 py-[1px] text-center text-[8px] font-medium uppercase tracking-[0.1em] text-[#FAF6EE]">
            Sobras
          </span>
        )}
        {firstRecipe?.variant === "freezer" && (
          <span className="absolute bottom-0 left-0 right-0 bg-[#1A1612]/85 px-1 py-[1px] text-center text-[8px] font-medium uppercase tracking-[0.1em] text-[#FAF6EE]">
            Congelador
          </span>
        )}
        {firstRecipe?.variant === "fridge" && (
          <span className="absolute bottom-0 left-0 right-0 bg-[#1A1612]/85 px-1 py-[1px] text-center text-[8px] font-medium uppercase tracking-[0.1em] text-[#FAF6EE]">
            Nevera
          </span>
        )}
        {isLocked && (
          <span title="Se queda si rehaces la semana" className="absolute left-1 top-1 inline-flex items-center rounded-full bg-[#FAF6EE]/95 p-1 text-[#1A1612] backdrop-blur-sm">
            <Lock size={9} strokeWidth={2} role="img" aria-label="Se queda si rehaces la semana" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <p className="m-0 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
            <MealIcon size={12} strokeWidth={1.6} />
            {mealLabel}
          </p>
          {menuButton && (
            // Neither a key nor a press on the "···" reaches the card (it opens the recipe and drags).
            <span
              data-row-menu="1"
              className="shrink-0"
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {menuButton}
            </span>
          )}
        </div>

        {servingsOverride != null && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="inline-flex items-center gap-0.5 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.12em] text-[#7A7066]">
              <Users size={9} strokeWidth={2} />
              {servingsOverride} pax
            </span>
          </div>
        )}

        {/* Every dish is shown, not just the first; a note edits in place. */}
        <ul className="mt-1 space-y-0.5">
          {dishes.map((dish, i) => (
            <li key={i} data-dish-row="1" className="flex items-center gap-1.5">
              {dish.kind === "recipe" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectRecipe(dish.recipeId)
                  }}
                  className="block min-w-0 flex-1 truncate text-left text-[13px] font-medium text-[#1A1612] hover:text-[#C65D38]"
                  title={dish.recipeName ?? undefined}
                >
                  {shortRecipeName(dish.recipeName ?? "Receta")}
                </button>
              ) : (
                <div className="min-w-0 flex-1">
                  <NoteEditor
                    text={dish.text}
                    onSave={(text) => onEditNote(i, text)}
                    onRemove={() => onRemoveDish(i)}
                    variant="inline"
                  />
                </div>
              )}
            </li>
          ))}
        </ul>

        {weekType && (
          <p
            data-testid="week-row-week-type"
            className={`mt-0.5 text-[11px] leading-tight ${weekType.missing ? "font-medium text-terracotta-deep" : "text-[#7A7066]"}`}
          >
            {weekType.missing ? "Sin receta de ese tipo" : weekType.label}
          </p>
        )}

        {cellData?.totalMinutes != null && cellData.totalMinutes > 0 && (
          <p className="mt-0.5 text-[11px] text-[#7A7066]">{cellData.totalMinutes} min</p>
        )}
      </div>
    </div>
  )
}

function RowPreview({ data }: { data: CellData }) {
  const { Icon: MealIcon, label } = MEAL_META[data.meal]
  return (
    <div className="pointer-events-none w-[280px] rounded-xl border border-[#1A1612]/30 bg-[#FFFEFA] px-2 py-2 shadow-[0_8px_24px_-8px_rgba(26,22,18,0.35)]">
      <div className="flex items-center gap-3">
        <div className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-[#F2EDE0]">
          <RecipeCover src={data.imageUrl} name={data.recipeName} meal={data.meal} className="h-full w-full" />
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
  const match = /^row-(\d+)-(breakfast|lunch|dinner|snack)$/.exec(id)
  if (!match) return null
  return { day: Number(match[1]), meal: match[2] as MealKey }
}
