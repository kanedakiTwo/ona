"use client"

/**
 * "Vista semana" — at mobile (default) renders each day as a stacked row of
 * meal cards; at lg+ it expands into a 7-column grid where each day is a
 * column and each slot is a card with feature-parity to Vista día.
 *
 * Parity surface (lg+):
 *   - All recipe dishes in a slot are shown (not just the first).
 *   - Note dishes ("comemos fuera") render inline.
 *   - The slot's pinned type, lock state, and servings override surface as
 *     small chips above / next to the title.
 *   - The "..." menu carries the full action set: Elegir / Aleatorio / Añadir
 *     plato / Bloquear / Vetar / Quitar. The popover is portalled to
 *     document.body so it can never be clipped or stacked below a sibling
 *     card (motion.article children create their own stacking contexts; only
 *     escaping to the root works).
 *   - All mutations dispatch the SAME hooks Vista día uses, so the query
 *     cache invalidation is shared and toggling between the two views
 *     reflects each other instantly.
 *
 * Mobile keeps the compact one-row-per-slot layout because tapping a day
 * header flips to Vista día one tap away for finer per-dish controls; the
 * grid view's purpose is the bird's-eye glance.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
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
import {
  Ban,
  CalendarX,
  ChevronRight,
  Coffee,
  Lock,
  MoreHorizontal,
  Moon,
  Pin,
  Plus,
  Replace,
  RotateCcw,
  Shuffle,
  Sun,
  Sunrise,
  Sunset,
  Trash2,
  Unlock,
  Users,
  Utensils,
} from "lucide-react"
import {
  MEAL_TYPE_TAG_LABELS,
  type DayMenu,
  type Dish,
  type MealSlot,
  type RecipeDish,
} from "@ona/shared"
import { shortRecipeName } from "@/lib/recipeView"
import { RecipePickerSheet } from "@/components/menu/RecipePickerSheet"
import { AddDishSheet } from "@/components/menu/AddDishSheet"

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

interface LockedMap {
  [dayIndex: string]: { [meal: string]: boolean } | undefined
}

interface Props {
  days: DayMenu[]
  weekStart: string
  todayIndex: number
  skippedDays?: number[]
  /** Lock state per slot — drives the "Fijado" chip + the menu's Bloquear/Desbloquear label. */
  lockedSlots?: LockedMap
  /** Household-derived diner count, used as the fallback when the slot has no override. */
  defaultDiners?: number
  onSelectDay: (dayIndex: number) => void
  onSelectRecipe: (recipeId: string) => void
  onMoveSlot?: (params: {
    fromDay: number
    fromMeal: MealKey
    toDay: number
    toMeal: MealKey
  }) => void
  onUnskipDay?: (dayIndex: number) => void
  /** Aleatorio — server-side matcher picks a new recipe for the slot. */
  onRandomize?: (day: number, meal: MealKey) => void
  /** Vetar la primera receta del slot para el resto de la semana. */
  onBan?: (day: number, meal: MealKey, recipeId: string) => void
  /** Quitar el slot entero del día (no la receta individual). */
  onRemove?: (day: number, meal: MealKey) => void
  /** "+ Añadir" en slot vacío → opens RecipePickerSheet inline → server replaces. */
  onAddRecipe?: (day: number, meal: MealKey, recipeId: string) => void
  /** Elegir receta en slot lleno → opens RecipePickerSheet inline → server replaces. */
  onPickRecipe?: (day: number, meal: MealKey, recipeId: string) => void
  /** Bloquear/Desbloquear slot — same toggle as Vista día. */
  onToggleLock?: (day: number, meal: MealKey, nextLocked: boolean) => void
  /** Añadir plato extra al slot (multi-dish) — opens AddDishSheet. */
  onAddDish?: (day: number, meal: MealKey, payload: { kind: 'recipe'; recipeId: string } | { kind: 'note'; text: string }) => void
  /** Aleatorio que **añade** un plato adicional al slot (no reemplaza el primero). */
  onAddRandomDish?: (day: number, meal: MealKey) => void
}

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
  lockedSlots,
  defaultDiners,
  onSelectDay,
  onSelectRecipe,
  onMoveSlot,
  onUnskipDay,
  onRandomize,
  onBan,
  onRemove,
  onAddRecipe,
  onPickRecipe,
  onToggleLock,
  onAddDish,
  onAddRandomDish,
}: Props) {
  const start = new Date(weekStart + "T00:00:00")
  const skippedSet = useMemo(() => new Set(skippedDays ?? []), [skippedDays])

  // Meal types that have at least one *template-active* slot somewhere in
  // the week. Counts slot KEYS (not dish content) so empty-mode menus
  // still show the user's configured template slots as tappable "+ Añadir"
  // cards instead of collapsing to "— sin platos —". No hardcoded fallback
  // — we always defer to the user's actual configured template.
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
          className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] lg:rounded-none lg:border-0 lg:bg-transparent lg:grid lg:grid-cols-7 lg:gap-3"
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
              locked={lockedSlots?.[String(di)] ?? {}}
              defaultDiners={defaultDiners}
              onSelectDay={onSelectDay}
              onSelectRecipe={onSelectRecipe}
              onUnskipDay={onUnskipDay}
              onRandomize={onRandomize}
              onBan={onBan}
              onRemove={onRemove}
              onAddRecipe={onAddRecipe}
              onPickRecipe={onPickRecipe}
              onToggleLock={onToggleLock}
              onAddDish={onAddDish}
              onAddRandomDish={onAddRandomDish}
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
  locked,
  defaultDiners,
  onSelectDay,
  onSelectRecipe,
  onUnskipDay,
  onRandomize,
  onBan,
  onRemove,
  onAddRecipe,
  onPickRecipe,
  onToggleLock,
  onAddDish,
  onAddRandomDish,
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
  locked: { [meal: string]: boolean }
  defaultDiners?: number
  onSelectDay: (dayIndex: number) => void
  onSelectRecipe: (recipeId: string) => void
  onUnskipDay?: (dayIndex: number) => void
  onRandomize?: (day: number, meal: MealKey) => void
  onBan?: (day: number, meal: MealKey, recipeId: string) => void
  onRemove?: (day: number, meal: MealKey) => void
  onAddRecipe?: (day: number, meal: MealKey, recipeId: string) => void
  onPickRecipe?: (day: number, meal: MealKey, recipeId: string) => void
  onToggleLock?: (day: number, meal: MealKey, nextLocked: boolean) => void
  onAddDish?: (day: number, meal: MealKey, payload: { kind: 'recipe'; recipeId: string } | { kind: 'note'; text: string }) => void
  onAddRandomDish?: (day: number, meal: MealKey) => void
  isFirst: boolean
  isLast: boolean
}) {
  const hasAnyMeal = visibleMeals.some((m) => day?.[m] != null)
  const sectionBg = isSkipped ? "bg-[#F2EDE0]/60" : isToday ? "bg-[#FDEEE8]" : ""
  const headerBg = isSkipped ? "bg-[#F2EDE0]" : isToday ? "bg-[#FDEEE8]" : "bg-[#FFFEFA]"

  return (
    <section
      data-day={dayIndex}
      className={`${sectionBg} ${
        !isFirst ? "border-t border-[#DDD6C5] lg:border-t-0" : ""
      } ${isFirst ? "rounded-t-2xl lg:rounded-2xl" : ""} ${
        isLast ? "rounded-b-2xl lg:rounded-2xl" : ""
      } lg:border lg:border-[#DDD6C5] lg:rounded-2xl`}
    >
      {/* Mobile header (clickable, flips to Vista día). */}
      <button
        type="button"
        onClick={() => onSelectDay(dayIndex)}
        className={`lg:hidden sticky top-0 z-10 flex w-full items-center justify-between px-4 pt-3 pb-2 text-left backdrop-blur-sm ${headerBg}/95`}
        aria-label={`Ir al día ${dayName} ${date}`}
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
      {/* Desktop header (static, no flip target at lg+). */}
      <div
        className={`hidden lg:flex w-full flex-col items-start gap-1 px-4 pt-3 pb-2 ${headerBg}`}
      >
        <span
          className={`whitespace-nowrap text-[13px] font-medium ${
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
        <div className="px-2 pb-2 md:px-3 lg:p-2 lg:space-y-2">
          {hasAnyMeal ? (
            visibleMeals.map((m) => {
              const slot = day?.[m] as MealSlot | undefined
              return (
                <SlotRow
                  key={m}
                  dayIndex={dayIndex}
                  meal={m}
                  slot={slot}
                  isLocked={Boolean(locked?.[m])}
                  defaultDiners={defaultDiners}
                  onSelectDay={onSelectDay}
                  onSelectRecipe={onSelectRecipe}
                  onRandomize={onRandomize}
                  onBan={onBan}
                  onRemove={onRemove}
                  onAddRecipe={onAddRecipe}
                  onPickRecipe={onPickRecipe}
                  onToggleLock={onToggleLock}
                  onAddDish={onAddDish}
                  onAddRandomDish={onAddRandomDish}
                />
              )
            })
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
  isLocked,
  defaultDiners,
  onSelectDay,
  onSelectRecipe,
  onRandomize,
  onBan,
  onRemove,
  onAddRecipe,
  onPickRecipe,
  onToggleLock,
  onAddDish,
  onAddRandomDish,
}: {
  dayIndex: number
  meal: MealKey
  slot: MealSlot | undefined
  isLocked: boolean
  defaultDiners?: number
  onSelectDay: (dayIndex: number) => void
  onSelectRecipe: (recipeId: string) => void
  onRandomize?: (day: number, meal: MealKey) => void
  onBan?: (day: number, meal: MealKey, recipeId: string) => void
  onRemove?: (day: number, meal: MealKey) => void
  onAddRecipe?: (day: number, meal: MealKey, recipeId: string) => void
  onPickRecipe?: (day: number, meal: MealKey, recipeId: string) => void
  onToggleLock?: (day: number, meal: MealKey, nextLocked: boolean) => void
  onAddDish?: (day: number, meal: MealKey, payload: { kind: 'recipe'; recipeId: string } | { kind: 'note'; text: string }) => void
  onAddRandomDish?: (day: number, meal: MealKey) => void
}) {
  const dropId = `row-${dayIndex}-${meal}`
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId,
    data: { dayIndex, meal },
  })
  const { label: mealLabel, Icon: MealIcon } = MEAL_META[meal]
  const [emptyPickerOpen, setEmptyPickerOpen] = useState(false)
  const [replacePickerOpen, setReplacePickerOpen] = useState(false)
  const [addDishOpen, setAddDishOpen] = useState(false)

  const dishes: Dish[] = slot?.dishes ?? []
  const recipeDishes = dishes.filter((d): d is RecipeDish => d.kind === 'recipe')
  const firstRecipe = recipeDishes[0] ?? null
  const slotPinnedType = firstRecipe?.pinnedType ?? null
  const slotServingsOverride = slot?.servings ?? null

  // Empty slot (no dishes at all) — keep the dashed "+ Añadir" affordance.
  if (dishes.length === 0) {
    return (
      <>
      <button
        ref={setDropRef as unknown as React.LegacyRef<HTMLButtonElement>}
        type="button"
        onClick={() => {
          if (onAddRecipe) setEmptyPickerOpen(true)
          else onSelectDay(dayIndex)
        }}
        className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors lg:flex-col lg:items-stretch lg:gap-0 lg:px-0 lg:py-0 lg:rounded-lg lg:border lg:border-dashed lg:border-[#DDD6C5] lg:bg-[#FFFEFA]/40 ${
          isOver ? "bg-[#1A1612]/10 lg:border-[#1A1612]/40 lg:bg-[#1A1612]/5" : "hover:bg-[#F2EDE0] lg:hover:border-[#1A1612]/40 lg:hover:bg-[#F2EDE0]/40"
        }`}
      >
        <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-lg border border-dashed border-[#DDD6C5] bg-[#F2EDE0]/40 text-[#A39A8E] lg:h-auto lg:w-full lg:rounded-none lg:rounded-t-lg lg:aspect-[4/3] lg:border-0 lg:border-b lg:border-dashed lg:border-[#DDD6C5]">
          <MealIcon size={18} strokeWidth={1.3} className="lg:hidden" />
          <MealIcon size={28} strokeWidth={1.2} className="hidden lg:inline" />
        </div>
        <div className="min-w-0 flex-1 lg:px-2 lg:pt-1.5 lg:pb-2">
          <p className="m-0 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
            <MealIcon size={12} strokeWidth={1.6} className="lg:hidden" />
            {mealLabel}
          </p>
          <p className="mt-0.5 text-[13px] italic text-[#A39A8E] lg:mt-1 lg:text-[12px]">
            + Añadir
          </p>
        </div>
      </button>
      <RecipePickerSheet
        open={emptyPickerOpen}
        onClose={() => setEmptyPickerOpen(false)}
        title={`${mealLabel} del día`}
        subtitle="Sin plato"
        onPick={(picked) => {
          if (onAddRecipe) onAddRecipe(dayIndex, meal, picked.id)
          setEmptyPickerOpen(false)
        }}
      />
      </>
    )
  }

  // Slot has at least one dish. Build the action set once — only the
  // callbacks the parent wired show up.
  const actions: ActionDef[] = []
  if (onPickRecipe && firstRecipe) {
    actions.push({
      icon: Replace,
      label: "Elegir receta",
      onSelect: () => setReplacePickerOpen(true),
    })
  }
  if (onRandomize) {
    actions.push({
      icon: Shuffle,
      label: "Aleatorio",
      onSelect: () => onRandomize(dayIndex, meal),
    })
  }
  if (onAddDish || onAddRandomDish) {
    actions.push({
      icon: Plus,
      label: "Añadir plato",
      onSelect: () => setAddDishOpen(true),
    })
  }
  if (onToggleLock) {
    actions.push({
      icon: isLocked ? Unlock : Lock,
      label: isLocked ? "Desbloquear" : "Bloquear",
      onSelect: () => onToggleLock(dayIndex, meal, !isLocked),
    })
  }
  if (onBan && firstRecipe) {
    actions.push({
      icon: Ban,
      label: "Vetar receta",
      onSelect: () => {
        if (
          typeof window === "undefined" ||
          window.confirm(
            `¿Vetar "${firstRecipe.recipeName ?? 'esta receta'}" del resto de la semana?`,
          )
        ) {
          onBan(dayIndex, meal, firstRecipe.recipeId)
        }
      },
      destructive: true,
    })
  }
  if (onRemove) {
    actions.push({
      icon: Trash2,
      label: "Quitar slot",
      onSelect: () => {
        if (
          typeof window === "undefined" ||
          window.confirm("¿Quitar este plato del día?")
        ) {
          onRemove(dayIndex, meal)
        }
      },
      destructive: true,
    })
  }

  // Drag preview uses the first recipe dish; if the slot is note-only we
  // still render a card but disable dragging (no recipeId to carry).
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
    <div ref={setDropRef} className={`relative ${isOver ? "rounded-xl ring-2 ring-inset ring-[#1A1612]/40" : ""}`}>
      <FilledRow
        dayIndex={dayIndex}
        meal={meal}
        mealLabel={mealLabel}
        MealIcon={MealIcon}
        dishes={dishes}
        firstRecipe={firstRecipe}
        cellData={cellData}
        isLocked={isLocked}
        slotPinnedType={slotPinnedType}
        slotServingsOverride={slotServingsOverride}
        defaultDiners={defaultDiners}
        actions={actions}
        canAddDish={Boolean(onAddDish || onAddRandomDish)}
        onOpenAddDish={() => setAddDishOpen(true)}
        onSelectDay={onSelectDay}
        onSelectRecipe={onSelectRecipe}
      />
    </div>
    {/* Sheets live as siblings outside the card so they don't collide
        with stacking contexts created by motion / overflow-hidden. */}
    <RecipePickerSheet
      open={replacePickerOpen}
      onClose={() => setReplacePickerOpen(false)}
      title={`${mealLabel} del día`}
      subtitle={firstRecipe?.recipeName ? `Ahora: ${firstRecipe.recipeName}` : "Sin plato"}
      onPick={(picked) => {
        if (onPickRecipe) onPickRecipe(dayIndex, meal, picked.id)
        setReplacePickerOpen(false)
      }}
    />
    <AddDishSheet
      open={addDishOpen}
      onClose={() => setAddDishOpen(false)}
      slotLabel={`${mealLabel} del día`}
      onPickAleatorio={() => {
        if (onAddRandomDish) onAddRandomDish(dayIndex, meal)
        setAddDishOpen(false)
      }}
      onPickRecipe={(recipeId) => {
        if (onAddDish) onAddDish(dayIndex, meal, { kind: 'recipe', recipeId })
        setAddDishOpen(false)
      }}
      onAddNote={(text) => {
        if (onAddDish) onAddDish(dayIndex, meal, { kind: 'note', text })
        setAddDishOpen(false)
      }}
    />
    </>
  )
}

interface ActionDef {
  icon: typeof Shuffle
  label: string
  onSelect: () => void
  destructive?: boolean
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
  slotPinnedType,
  slotServingsOverride,
  defaultDiners,
  actions,
  canAddDish,
  onOpenAddDish,
  onSelectDay,
  onSelectRecipe,
}: {
  dayIndex: number
  meal: MealKey
  mealLabel: string
  MealIcon: typeof Sun
  dishes: Dish[]
  firstRecipe: RecipeDish | null
  cellData: CellData | null
  isLocked: boolean
  slotPinnedType: string | null
  slotServingsOverride: number | null
  defaultDiners?: number
  actions: ActionDef[]
  canAddDish: boolean
  onOpenAddDish: () => void
  onSelectDay: (dayIndex: number) => void
  onSelectRecipe: (recipeId: string) => void
}) {
  // Drag handle is the whole card (first recipe carries the drag payload).
  // If the slot is note-only we render but skip drag wiring.
  const dragId = cellData ? `row-${dayIndex}-${meal}` : `noop-${dayIndex}-${meal}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: cellData ?? { day: dayIndex, meal, isPlaceholder: true },
    disabled: cellData == null,
  })

  // The image and the "..." menu live inside the same card. The card itself
  // is the drag handle on lg+. The menu's portalled popover keeps clicks
  // outside the card to avoid drag conflicts (target.closest catches them).
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
        // Clicks on the action menu or its dishes manage their own targets.
        if (target.closest('[data-row-menu="1"]')) return
        if (target.closest('[data-dish-row="1"]')) return
        if (target.closest('[data-add-dish="1"]')) return
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
      className={`relative flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors lg:flex-col lg:items-stretch lg:gap-0 lg:px-0 lg:py-0 lg:rounded-lg lg:border lg:border-[#DDD6C5] lg:bg-[#FFFEFA] ${
        isDragging ? "opacity-30" : "hover:bg-[#F2EDE0] lg:hover:opacity-95"
      }`}
    >
      <div className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-[#F2EDE0] lg:h-auto lg:w-full lg:rounded-none lg:rounded-t-lg lg:aspect-[4/3]">
        {firstRecipe?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={firstRecipe.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[#7A7066]">
            <Utensils size={20} strokeWidth={1.4} />
          </div>
        )}
        {firstRecipe?.variant === "leftover" && (
          <span className="absolute bottom-0 left-0 right-0 bg-[#1A1612]/85 px-1 py-[1px] text-center text-[8px] font-medium uppercase tracking-[0.1em] text-[#FAF6EE]">
            Sobras
          </span>
        )}
        {cellData?.totalMinutes != null && cellData.totalMinutes > 0 && (
          <span className="absolute right-1 top-1 hidden rounded-full bg-[#FAF6EE]/95 px-1.5 py-0.5 text-[9px] font-medium text-[#1A1612] backdrop-blur-sm lg:inline-flex">
            {cellData.totalMinutes}'
          </span>
        )}
        {isLocked && (
          <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-[#C65D38] px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE] backdrop-blur-sm">
            <Lock size={9} strokeWidth={2} />
            Fijado
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 lg:px-2 lg:pt-1.5 lg:pb-2">
        <div className="flex items-center justify-between gap-1">
          <p className="m-0 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
            <MealIcon size={12} strokeWidth={1.6} />
            {mealLabel}
          </p>
          {actions.length > 0 && (
            <RowActionsButton actions={actions} />
          )}
        </div>

        {/* Pinned-type + servings chips (mirror Vista día's surface). */}
        {(slotPinnedType || slotServingsOverride != null) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {slotPinnedType && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-[#C65D38]/30 bg-[#FDEEE8] px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.12em] text-[#C65D38]">
                <Pin size={9} strokeWidth={2} />
                {(MEAL_TYPE_TAG_LABELS as Record<string, string>)[slotPinnedType] ?? slotPinnedType}
              </span>
            )}
            {slotServingsOverride != null && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.12em] text-[#7A7066]">
                <Users size={9} strokeWidth={2} />
                {slotServingsOverride} pax
              </span>
            )}
          </div>
        )}

        {/* Dish list — every dish is shown, not just the first. */}
        <ul className="mt-1 space-y-0.5">
          {dishes.map((dish, i) => (
            <li
              key={i}
              data-dish-row="1"
              className="flex items-center gap-1.5"
            >
              {dish.kind === 'recipe' ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectRecipe(dish.recipeId)
                  }}
                  className="block min-w-0 flex-1 truncate text-left text-[13px] font-medium text-[#1A1612] hover:text-[#C65D38] lg:line-clamp-2 lg:whitespace-normal lg:text-[12.5px] lg:leading-snug"
                  title={dish.recipeName ?? undefined}
                >
                  {shortRecipeName(dish.recipeName ?? "Receta")}
                </button>
              ) : (
                <span className="flex min-w-0 flex-1 items-center gap-1 text-[12px] italic text-[#4A4239]">
                  <Coffee size={10} className="shrink-0 text-[#7A7066]" />
                  <span className="truncate">{dish.text}</span>
                </span>
              )}
            </li>
          ))}
        </ul>

        {/* "+ añadir" affordance only at lg+ where there's space for a
            secondary row; mobile users go through the full action menu. */}
        {canAddDish && (
          <button
            type="button"
            data-add-dish="1"
            onClick={(e) => {
              e.stopPropagation()
              onOpenAddDish()
            }}
            className="mt-1.5 hidden w-full items-center justify-center gap-1 rounded-md border border-dashed border-[#DDD6C5] py-1 text-[9px] uppercase tracking-[0.12em] text-[#7A7066] transition-colors hover:border-[#1A1612] hover:text-[#1A1612] lg:flex"
          >
            <Plus size={9} />
            Añadir plato
          </button>
        )}

        {cellData?.totalMinutes != null && cellData.totalMinutes > 0 && (
          <p className="mt-0.5 text-[11px] text-[#7A7066] lg:hidden">
            {cellData.totalMinutes} min
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * "..." menu trigger + popover. The popover is rendered into document.body
 * via createPortal — sibling `motion.article` cards each create their own
 * stacking context (transform / will-change), so any in-tree z-index would
 * be clipped or hidden behind a neighbouring card image. Portalling to the
 * root escapes every parent stacking context permanently.
 */
function RowActionsButton({ actions }: { actions: ActionDef[] }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPos({
        top: r.bottom + 4,
        right: Math.max(8, window.innerWidth - r.right),
      })
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open])

  return (
    <div data-row-menu="1" className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="rounded-full p-1 text-[#7A7066] transition-colors hover:bg-[#F2EDE0] hover:text-[#1A1612]"
        aria-label="Acciones rápidas"
        aria-expanded={open}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && typeof window !== "undefined" && pos && createPortal(
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
            }}
            className="fixed inset-0 z-[60] cursor-default bg-transparent"
          />
          <div
            data-row-menu="1"
            className="fixed z-[70] w-44 overflow-hidden rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] shadow-[0_12px_24px_-12px_rgba(26,22,18,0.28)]"
            style={{ top: pos.top, right: pos.right }}
          >
            {actions.map((a) => {
              const Icon = a.icon
              return (
                <button
                  key={a.label}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    a.onSelect()
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[#F2EDE0] ${
                    a.destructive ? "text-[#C65D38]" : "text-[#1A1612]"
                  }`}
                >
                  <Icon size={13} strokeWidth={1.6} />
                  {a.label}
                </button>
              )
            })}
          </div>
        </>,
        document.body,
      )}
    </div>
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
  const match = /^row-(\d+)-(breakfast|lunch|dinner|snack)$/.exec(id)
  if (!match) return null
  return { day: Number(match[1]), meal: match[2] as MealKey }
}
