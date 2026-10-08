"use client"

/**
 * /menu at lg+ ("D · Luz y foto", desktop):
 *   1. hero row (1.75fr / 1fr): the selected day's featured meal as a 420 px
 *      photo card with the caption card inside; on the right the day's next
 *      meal (photo card) and a preview of the following day;
 *   2. "La semana": seven columns — day label (click = show that day above),
 *      a 118 px photo tile of the featured meal, its full name in Fraunces
 *      and the other meals as text lines. Every tile and line is a drop
 *      target and (when it holds a recipe) a drag source: dropping swaps the
 *      two slots via POST /menu/:id/move-slot (same contract as Vista semana).
 */
import { useState, type ReactNode } from "react"
import Link from "next/link"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { Lock, Plus, RotateCcw } from "lucide-react"
import type { DayMenu, MealSlot } from "@ona/shared"
import { mealLabel } from "@/lib/labels"
import {
  dateOfDay,
  firstRecipeDish,
  mealEyebrow,
  orderedSlots,
  slotMinutes,
  splitDay,
  weekColumnLabel,
  weekdayName,
  type DaySlot,
  type MealKey,
} from "@/lib/menuDay"
import { RecipeCover } from "./RecipeCover"
import { DayFooter, EmptyMealCard, MealHero, SkippedDay, type SlotPropsFn } from "./DayMeals"
import { MealOptionsButton, MealOptionsSheets, useMealOptions } from "./MealOptions"

interface Props {
  header: ReactNode
  weekStart: string
  days: DayMenu[]
  todayIndex: number
  selectedDay: number
  skippedDays: number[]
  readOnly: boolean
  isAddingMeal: boolean
  slotPropsFor: (day: number) => SlotPropsFn
  onSelectDay: (day: number) => void
  onMoveSlot: (p: { fromDay: number; fromMeal: MealKey; toDay: number; toMeal: MealKey }) => void
  onUnskipDay: (day: number) => void
  onSkipDay: (day: number) => void
  onAddMeal: (day: number, meal: MealKey) => void
  /** Rendered under the week (vetoes panel, pantry card). */
  footer?: ReactNode
}

interface DragData {
  day: number
  meal: MealKey
  name: string
  imageUrl: string | null
}

export function MenuDesktop(p: Props) {
  const day = p.days[p.selectedDay]
  const isSkipped = p.skippedDays.includes(p.selectedDay)
  const { featured, rest } = splitDay(day)
  const slotProps = p.slotPropsFor(p.selectedDay)
  const next = p.selectedDay + 1 <= 6 ? p.selectedDay + 1 : null
  const missing = (["breakfast", "lunch", "snack", "dinner"] as MealKey[]).filter((m) => !day || day[m] == null)

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-7 px-12 pt-8 pb-10">
      {p.header}

      {/* Hero row */}
      {isSkipped ? (
        <SkippedDay readOnly={p.readOnly} onUnskip={() => p.onUnskipDay(p.selectedDay)} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] gap-6">
          <div>
            {featured ? (
              <MealHero {...slotProps(featured.meal, featured.slot)} readOnly={p.readOnly} layout="card" />
            ) : (
              <div className="flex h-[420px] flex-col justify-center gap-3 rounded-[24px] border border-dashed border-border bg-paper/60 px-8">
                <p className="font-serif-text text-[26px] italic text-ink-mid">Este día aún no tiene platos.</p>
                <div className="flex max-w-[420px] flex-col gap-2">
                  {rest.map(({ meal, slot }) => (
                    <EmptyMealCard key={meal} {...slotProps(meal, slot)} readOnly={p.readOnly} compact />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {featured &&
              rest.map(({ meal, slot }, i) => (
                <SideMeal key={meal} meal={meal} slot={slot} big={i === 0} slotProps={slotProps} readOnly={p.readOnly} />
              ))}

            {next != null && (
              <NextDayPreview
                weekStart={p.weekStart}
                day={next}
                isTomorrow={p.selectedDay === p.todayIndex}
                slots={orderedSlots(p.days[next])}
                skipped={p.skippedDays.includes(next)}
              />
            )}

            {!p.readOnly && (
              <div className="-mx-4 mt-auto">
                <DayFooter
                  dayName={weekdayName(p.selectedDay)}
                  missing={missing}
                  canSkip={orderedSlots(day).length > 0}
                  isAdding={p.isAddingMeal}
                  onAddMeal={(m) => p.onAddMeal(p.selectedDay, m)}
                  onSkip={() => p.onSkipDay(p.selectedDay)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <WeekColumns {...p} />

      {p.footer}
    </div>
  )
}

/* ── Right column of the hero row: the day's other meals. */
function SideMeal({
  meal,
  slot,
  big,
  slotProps,
  readOnly,
}: {
  meal: MealKey
  slot: MealSlot
  big: boolean
  slotProps: SlotPropsFn
  readOnly: boolean
}) {
  const ctl = useMealOptions()
  const props = slotProps(meal, slot)
  const first = firstRecipeDish(slot)
  if ((slot.dishes ?? []).length === 0) {
    return <EmptyMealCard {...props} readOnly={readOnly} compact />
  }
  const title =
    first?.recipeName ?? (slot.dishes ?? []).map((d) => (d.kind === "note" ? d.text : "")).filter(Boolean).join(", ")
  const eyebrow = mealEyebrow(mealLabel(meal), slotMinutes(slot))
  const content = (
    <>
      <RecipeCover
        src={first?.imageUrl}
        name={title}
        meal={meal}
        className={big ? "h-[222px] w-full rounded-[20px]" : "h-[64px] w-[76px] shrink-0 rounded-xl"}
      />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          {props.ctx.isLocked && <Lock size={11} strokeWidth={2.2} aria-label="Fijada" />}
          {eyebrow}
        </span>
        <span className={`font-serif-text font-[650] leading-[1.1] text-ink ${big ? "text-[26px]" : "text-[18px]"}`}>
          {title}
        </span>
      </span>
    </>
  )
  return (
    <div className="relative">
      {first ? (
        <Link
          href={`/recipes/${first.recipeId}`}
          className={`flex text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink ${
            big ? "flex-col gap-2.5" : "items-center gap-3.5 pr-12"
          }`}
        >
          {content}
        </Link>
      ) : (
        <div className={`flex ${big ? "flex-col gap-2.5" : "items-center gap-3.5 pr-12"}`}>{content}</div>
      )}
      {!readOnly && (
        <>
          <MealOptionsButton
            ctl={ctl}
            label={`Más opciones de ${mealLabel(meal).toLowerCase()}`}
            className={big ? "absolute right-3 top-3 bg-paper/95 shadow-sm" : "absolute right-0 top-1/2 -translate-y-1/2 text-ink-mid"}
          />
          <MealOptionsSheets ctl={ctl} {...props} />
        </>
      )}
    </div>
  )
}

function NextDayPreview({
  weekStart,
  day,
  isTomorrow,
  slots,
  skipped,
}: {
  weekStart: string
  day: number
  isTomorrow: boolean
  slots: DaySlot[]
  skipped: boolean
}) {
  const name = weekdayName(day)
  const label = isTomorrow ? `Mañana, ${name}` : `${name.charAt(0).toUpperCase()}${name.slice(1)} ${dateOfDay(weekStart, day).getDate()}`
  const filled = slots.filter((s) => firstRecipeDish(s.slot))
  return (
    <div className="flex flex-col gap-2.5 border-t border-border pt-3.5">
      <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{label}</span>
      {skipped ? (
        <p className="text-[15px] italic text-ink-soft">Sin cocinar.</p>
      ) : filled.length === 0 ? (
        <p className="text-[15px] italic text-ink-soft">Aún sin platos.</p>
      ) : (
        filled.map(({ meal, slot }) => {
          const r = firstRecipeDish(slot)!
          return (
            <Link
              key={meal}
              href={`/recipes/${r.recipeId}`}
              className="flex items-center gap-3 rounded-xl text-[15px] text-ink hover:text-terracotta-deep focus-visible:outline-2 focus-visible:outline-ink"
            >
              <RecipeCover src={r.imageUrl} name={r.recipeName ?? ""} meal={meal} className="h-[52px] w-[52px] shrink-0 rounded-xl" />
              <span>
                <strong className="font-semibold">{mealLabel(meal)}:</strong> {r.recipeName}
              </span>
            </Link>
          )
        })
      )}
    </div>
  )
}

/* ─────────────────────────── La semana ─────────────────────────── */

function WeekColumns(p: Props) {
  const [dragging, setDragging] = useState<DragData | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  function onDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as DragData | undefined) ?? null)
    window.dispatchEvent(new Event("ona:dnd-start"))
  }
  function endDrag() {
    setDragging(null)
    window.dispatchEvent(new Event("ona:dnd-end"))
  }
  function onDragEnd(e: DragEndEvent) {
    endDrag()
    const from = e.active.data.current as DragData | undefined
    const to = e.over?.data.current as { day: number; meal: MealKey } | undefined
    if (!from || !to) return
    if (from.day === to.day && from.meal === to.meal) return
    p.onMoveSlot({ fromDay: from.day, fromMeal: from.meal, toDay: to.day, toMeal: to.meal })
  }

  return (
    <section aria-labelledby="la-semana" className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between">
        <h2 id="la-semana" className="font-serif-text text-[26px] font-medium italic text-ink">
          La semana
        </h2>
        {!p.readOnly && <span className="text-[13px] text-ink-muted">Arrastra un plato para cambiarlo de día</span>}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={endDrag}
      >
        <div className="grid grid-cols-7 gap-3.5" data-testid="week-columns">
          {p.days.map((day, d) => (
            <DayColumn key={d} d={d} day={day} {...p} />
          ))}
        </div>
        <DragOverlay>
          {dragging ? (
            <div className="pointer-events-none flex w-[220px] items-center gap-3 rounded-2xl border border-border bg-paper p-2 shadow-[0_12px_28px_-10px_rgba(26,22,18,0.35)]">
              <RecipeCover src={dragging.imageUrl} name={dragging.name} meal={dragging.meal} className="h-12 w-12 shrink-0 rounded-xl" />
              <span className="font-serif-text text-[15px] font-[650] leading-tight text-ink">{dragging.name}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  )
}

function DayColumn({ d, day, ...p }: Props & { d: number; day: DayMenu }) {
  const isToday = d === p.todayIndex
  const isSelected = d === p.selectedDay
  const skipped = p.skippedDays.includes(d)
  const slots = orderedSlots(day)
  const { featured } = splitDay(day)
  const tile = featured ?? slots[0] ?? null
  const lines = slots.filter((s) => s.meal !== tile?.meal)
  const slotProps = p.slotPropsFor(d)

  return (
    <div
      className={`-m-2 flex min-w-0 flex-col gap-2 rounded-2xl p-2 ${isSelected ? "bg-cream-deep" : ""}`}
      data-day-column={d}
    >
      <button
        type="button"
        onClick={() => p.onSelectDay(d)}
        aria-pressed={isSelected}
        className={`min-h-[32px] self-start rounded-full text-left text-[13px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ink ${
          isToday ? "text-terracotta-deep" : "text-ink-muted"
        }`}
      >
        {weekColumnLabel(p.weekStart, d, p.todayIndex)}
      </button>

      {skipped ? (
        <div className="flex h-[118px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border text-center">
          <span className="text-[13px] italic text-ink-soft">Sin cocinar</span>
          {!p.readOnly && (
            <button
              type="button"
              onClick={() => p.onUnskipDay(d)}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-border bg-paper px-3 text-[12px] text-ink hover:border-ink"
            >
              <RotateCcw size={12} /> Reactivar
            </button>
          )}
        </div>
      ) : (
        <>
          {tile && <SlotTile d={d} s={tile} slotProps={slotProps} readOnly={p.readOnly} />}
          {lines.map((s) => (
            <SlotLine key={s.meal} d={d} s={s} slotProps={slotProps} readOnly={p.readOnly} />
          ))}
          {!tile && <p className="text-[13px] italic text-ink-soft">Sin comidas</p>}
        </>
      )}
    </div>
  )
}

/** Shared DnD wiring for a slot: droppable always, draggable when it holds a recipe. */
function useSlotDnd(d: number, s: DaySlot) {
  const first = firstRecipeDish(s.slot)
  const drop = useDroppable({ id: `slot-${d}-${s.meal}`, data: { day: d, meal: s.meal } })
  const drag = useDraggable({
    id: `dish-${d}-${s.meal}`,
    disabled: !first,
    data: first
      ? ({ day: d, meal: s.meal, name: first.recipeName ?? "Receta", imageUrl: first.imageUrl ?? null } satisfies DragData)
      : undefined,
  })
  return { first, drop, drag }
}

/** Keep Enter/Space on inner links & buttons from starting a keyboard drag. */
const stopKeys = { onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() }

function SlotTile({ d, s, slotProps, readOnly }: { d: number; s: DaySlot; slotProps: SlotPropsFn; readOnly: boolean }) {
  const ctl = useMealOptions()
  const props = slotProps(s.meal, s.slot)
  const { first, drop, drag } = useSlotDnd(d, s)
  const empty = (s.slot.dishes ?? []).length === 0
  const title = first?.recipeName ?? (s.slot.dishes ?? []).map((x) => (x.kind === "note" ? x.text : "")).join(", ")

  // The sheets render as a sibling of the drag wrapper, never inside it:
  // React events bubble out of portals, so a keystroke in the recipe
  // picker would otherwise reach the wrapper's dnd-kit listeners.
  return (
    <>
    <div
      ref={(el) => {
        drop.setNodeRef(el)
        drag.setNodeRef(el)
      }}
      {...drag.listeners}
      {...(first ? { tabIndex: 0, "aria-roledescription": "plato arrastrable", "aria-describedby": drag.attributes["aria-describedby"] } : {})}
      aria-label={first ? `${mealLabel(s.meal)}: ${title}. Pulsa espacio para moverlo a otro día` : undefined}
      className={`group relative flex flex-col gap-2 rounded-[16px] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ink ${
        drag.isDragging ? "opacity-30" : ""
      } ${drop.isOver ? "ring-2 ring-ink/50 ring-offset-2 ring-offset-cream" : ""}`}
    >
      {empty ? (
        <button
          type="button"
          disabled={readOnly || props.ctx.isLocked}
          onClick={() => ctl.setOpen("addDish")}
          {...stopKeys}
          className="flex h-[118px] w-full flex-col items-center justify-center gap-1 rounded-[14px] border border-dashed border-border bg-paper/60 text-[13px] text-ink-mid hover:border-ink disabled:cursor-default"
        >
          {!readOnly && <Plus size={16} />}
          <span>
            {mealLabel(s.meal)}
            {readOnly ? " · sin plato" : ": añadir"}
          </span>
        </button>
      ) : (
        <Link
          href={first ? `/recipes/${first.recipeId}` : "#"}
          {...stopKeys}
          draggable={false}
          className="flex flex-col gap-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          onClick={(e) => {
            if (!first) e.preventDefault()
          }}
        >
          <RecipeCover src={first?.imageUrl} name={title} meal={s.meal} className="h-[118px] w-full rounded-[14px]" />
          <span className="font-serif-text text-[15px] font-[650] leading-[1.2] [text-wrap:pretty]">{title}</span>
        </Link>
      )}
      {props.ctx.isLocked && (
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-paper/95 px-1.5 py-0.5 text-[11px] font-medium text-ink">
          <Lock size={10} strokeWidth={2.2} /> Fijada
        </span>
      )}
      {!readOnly && (
        <span
          {...stopKeys}
          className="absolute right-0 top-0 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100"
        >
          <MealOptionsButton
            ctl={ctl}
            label={`Más opciones de ${mealLabel(s.meal).toLowerCase()} del ${weekdayName(d)}`}
            className="scale-[0.82] bg-paper/95 shadow-sm"
          />
        </span>
      )}
    </div>
    {!readOnly && <MealOptionsSheets ctl={ctl} {...props} />}
    </>
  )
}

function SlotLine({ d, s, slotProps, readOnly }: { d: number; s: DaySlot; slotProps: SlotPropsFn; readOnly: boolean }) {
  const ctl = useMealOptions()
  const props = slotProps(s.meal, s.slot)
  const { first, drop, drag } = useSlotDnd(d, s)
  const empty = (s.slot.dishes ?? []).length === 0
  const text =
    first?.recipeName ?? (s.slot.dishes ?? []).map((x) => (x.kind === "note" ? x.text : "")).filter(Boolean).join(", ")

  return (
    <>
    <div
      ref={(el) => {
        drop.setNodeRef(el)
        drag.setNodeRef(el)
      }}
      {...drag.listeners}
      {...(first ? { tabIndex: 0, "aria-roledescription": "plato arrastrable", "aria-describedby": drag.attributes["aria-describedby"] } : {})}
      aria-label={first ? `${mealLabel(s.meal)}: ${text}. Pulsa espacio para moverlo a otro día` : undefined}
      className={`group relative flex min-h-[36px] items-start gap-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ink ${
        drag.isDragging ? "opacity-30" : ""
      } ${drop.isOver ? "bg-paper ring-2 ring-ink/50" : ""}`}
    >
      {empty ? (
        <button
          type="button"
          disabled={readOnly || props.ctx.isLocked}
          onClick={() => ctl.setOpen("addDish")}
          {...stopKeys}
          className="flex-1 py-1 text-left text-[13px] leading-[1.3] text-ink-mid hover:text-ink disabled:cursor-default [@media(hover:none)]:pr-8"
        >
          {mealLabel(s.meal)}: <span className="italic">{readOnly ? "sin plato" : "+ añadir"}</span>
        </button>
      ) : first ? (
        <Link
          href={`/recipes/${first.recipeId}`}
          draggable={false}
          {...stopKeys}
          className="flex-1 py-1 text-[13px] leading-[1.3] text-ink-mid hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [@media(hover:none)]:pr-8"
        >
          {props.ctx.isLocked && <Lock size={10} className="mr-1 inline" aria-label="Fijada" />}
          {mealLabel(s.meal)}: {text}
        </Link>
      ) : (
        <span className="flex-1 py-1 text-[13px] leading-[1.3] text-ink-mid [@media(hover:none)]:pr-8">
          {mealLabel(s.meal)}: <span className="italic">{text}</span>
        </span>
      )}
      {!readOnly && (
        <span {...stopKeys} className="absolute -right-1.5 -top-1 rounded-full bg-paper shadow-sm transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
          <MealOptionsButton
            ctl={ctl}
            label={`Más opciones de ${mealLabel(s.meal).toLowerCase()} del ${weekdayName(d)}`}
            className="h-9 w-9 text-ink-mid"
          />
        </span>
      )}
    </div>
    {!readOnly && <MealOptionsSheets ctl={ctl} {...props} />}
    </>
  )
}
