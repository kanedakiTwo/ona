"use client"

/**
 * /menu at lg+ ("D · Luz y foto", desktop):
 *   1. hero row (1.75fr / 1fr): the selected day's featured meal as a 420 px
 *      photo card with the caption card inside; on the right the day's other
 *      meals (the first as a photo card), the meals it lacks («El viernes no
 *      hay comida»), "Añadir comida" / "Saltar día" and, at the bottom, a
 *      preview of the following day;
 *   2. "La semana": seven columns — day label, a 118 px photo tile of the
 *      featured meal with its meal («Cena») and full name in Fraunces, the
 *      other meals as text lines and the absent ones as «Comida: no hay».
 *      Clicking anywhere in a column shows that day above (scrolling back up
 *      to it); the recipe opens from there. Hovering a line shows its dish's
 *      photo on the tile (Miguel, 2026-10-19).
 *
 * Drag and drop spans both (one DndContext): every dish, empty slot and
 * «no hay» line — in the week, the hero row and the next day's preview — is
 * a drop target, and every dish a drag source. Dropping swaps the two slots,
 * or moves the dish to a meal the day lacks (the source slot goes away), via
 * POST /menu/:id/move-slot (same contract as Vista semana). The week also
 * drags with the keyboard (Space); the hero row, with the mouse.
 */
import { useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useReducedMotion } from "motion/react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDndContext,
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
  absentMeals,
  DAY_MEAL_ORDER,
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
import { AbsentMealCard, DayFooter, EmptyMealCard, MealHero, SkippedDay, type SlotPropsFn } from "./DayMeals"
import { MealOptionsButton, MealOptionsSheets, slotRecipeHref, useMealOptions } from "./MealOptions"

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
  onAddFreezer?: (day: number, meal: MealKey, recipeId: string) => void
  /** Rendered under the week (vetoes panel, pantry card). */
  footer?: ReactNode
}

interface DragData {
  day: number
  meal: MealKey
  name: string
  imageUrl: string | null
}

/** Where a slot is drawn: the same slot can be in the week and in the hero row at once. */
type DndScope = "week" | "hero" | "next"

/**
 * When the last drag ended. A drag dropped back where it started ends in a
 * click on the dish, which would open its recipe or change the day.
 */
let lastDragEnd = 0
const swallowClickAfterDrag = (e: React.MouseEvent) => {
  if (Date.now() - lastDragEnd < 300) {
    e.preventDefault()
    e.stopPropagation()
  }
}

export function MenuDesktop(p: Props) {
  const reduce = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<DragData | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )
  const day = p.days[p.selectedDay]
  const isSkipped = p.skippedDays.includes(p.selectedDay)
  const { featured, rest } = splitDay(day)
  const slotProps = p.slotPropsFor(p.selectedDay)
  const next = p.selectedDay + 1 <= 6 ? p.selectedDay + 1 : null
  const missing = DAY_MEAL_ORDER.filter((m) => !day || day[m] == null)
  const dayName = weekdayName(p.selectedDay)
  const absent = absentMeals(p.days, p.selectedDay, p.skippedDays)

  function onDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as DragData | undefined) ?? null)
    window.dispatchEvent(new Event("ona:dnd-start"))
  }
  function endDrag() {
    setDragging(null)
    lastDragEnd = Date.now()
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

  /** «La semana» → that day in the hero row, scrolling back up when the row is off screen. */
  function showDay(d: number) {
    p.onSelectDay(d)
    if ((heroRef.current?.getBoundingClientRect().top ?? 0) < 0) {
      rootRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
    }
  }

  /** The day's other meals and the ones it lacks, in the order of the day. */
  const sideMeals = (cards: (s: DaySlot) => ReactNode) =>
    DAY_MEAL_ORDER.map((m) => {
      const s = rest.find((r) => r.meal === m)
      if (s) return cards(s)
      if (!absent.includes(m)) return null
      return (
        <SlotDrop key={m} scope="hero" d={p.selectedDay} meal={m} className="rounded-2xl">
          <AbsentMealCard
            meal={m}
            dayName={dayName}
            isAdding={p.isAddingMeal}
            onAdd={(meal) => p.onAddMeal(p.selectedDay, meal)}
            readOnly={p.readOnly}
            compact
          />
        </SlotDrop>
      )
    })

  return (
    <div ref={rootRef} className="mx-auto flex max-w-[1180px] scroll-mt-4 flex-col gap-7 px-12 pt-8 pb-10">
      {p.header}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={endDrag}
      >
        {/* Hero row */}
        <div ref={heroRef}>
          {isSkipped ? (
            <SkippedDay readOnly={p.readOnly} onUnskip={() => p.onUnskipDay(p.selectedDay)} />
          ) : (
            <div className="grid grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] gap-6">
              <div data-first-steps="dish">
                {featured ? (
                  <HeroSlot scope="hero" d={p.selectedDay} meal={featured.meal} slot={featured.slot} className="rounded-[24px]">
                    <MealHero {...slotProps(featured.meal, featured.slot)} readOnly={p.readOnly} layout="card" />
                  </HeroSlot>
                ) : (
                  <div className="flex h-[420px] flex-col justify-center gap-3 rounded-[24px] border border-dashed border-border bg-paper/60 px-8">
                    <p className="font-serif-text text-[26px] italic text-ink-mid">Este día aún no tiene platos.</p>
                    <div className="flex max-w-[420px] flex-col gap-2">
                      {sideMeals(({ meal, slot }) => (
                        <HeroSlot key={meal} scope="hero" d={p.selectedDay} meal={meal} slot={slot} className="rounded-2xl">
                          <EmptyMealCard {...slotProps(meal, slot)} readOnly={p.readOnly} compact />
                        </HeroSlot>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4">
                {featured &&
                  sideMeals(({ meal, slot }) => (
                    <SideMeal
                      key={meal}
                      d={p.selectedDay}
                      meal={meal}
                      slot={slot}
                      big={meal === rest[0]?.meal}
                      slotProps={slotProps}
                      readOnly={p.readOnly}
                    />
                  ))}

                {/* With the day's meals, not under the next day's preview: it reads as that day's. */}
                {!p.readOnly && (
                  <div className="-mx-4">
                    <DayFooter
                      dayName={dayName}
                      missing={missing}
                      canSkip={orderedSlots(day).length > 0}
                      isAdding={p.isAddingMeal}
                      onAddMeal={(m) => p.onAddMeal(p.selectedDay, m)}
                      onSkip={() => p.onSkipDay(p.selectedDay)}
                      onAddFreezer={p.onAddFreezer ? (m, id) => p.onAddFreezer!(p.selectedDay, m, id) : undefined}
                    />
                  </div>
                )}

                {next != null && (
                  <div className="mt-auto">
                    <NextDayPreview
                      weekStart={p.weekStart}
                      day={next}
                      isTomorrow={p.selectedDay === p.todayIndex}
                      slots={orderedSlots(p.days[next])}
                      absent={absentMeals(p.days, next, p.skippedDays)}
                      skipped={p.skippedDays.includes(next)}
                      onShow={() => p.onSelectDay(next)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <WeekColumns {...p} onSelectDay={showDay} />

        <DragOverlay>
          {dragging ? (
            <div className="pointer-events-none flex w-[220px] items-center gap-3 rounded-2xl border border-border bg-paper p-2 shadow-[0_12px_28px_-10px_rgba(26,22,18,0.35)]">
              <RecipeCover src={dragging.imageUrl} name={dragging.name} meal={dragging.meal} className="h-12 w-12 shrink-0 rounded-xl" />
              <span className="font-serif-text text-[15px] font-[650] leading-tight text-ink">{dragging.name}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {p.footer}
    </div>
  )
}

/* ─────────────────────────── Drag and drop ─────────────────────────── */

/** A slot's DnD wiring: droppable always, draggable when it holds a recipe. */
function useSlotDnd(scope: DndScope, d: number, meal: MealKey, slot: MealSlot) {
  const first = firstRecipeDish(slot)
  const drop = useDroppable({ id: `${scope}-slot-${d}-${meal}`, data: { day: d, meal } })
  const drag = useDraggable({
    id: `${scope}-dish-${d}-${meal}`,
    disabled: !first,
    data: first
      ? ({ day: d, meal, name: first.recipeName ?? "Receta", imageUrl: first.imageUrl ?? null } satisfies DragData)
      : undefined,
  })
  return { first, drop, drag }
}

/** A meal the day lacks: dropping a dish here moves it to that meal. */
function SlotDrop({
  scope,
  d,
  meal,
  className = "",
  children,
}: {
  scope: DndScope
  d: number
  meal: MealKey
  className?: string
  children: ReactNode
}) {
  const drop = useDroppable({ id: `${scope}-slot-${d}-${meal}`, data: { day: d, meal } })
  return (
    <div
      ref={drop.setNodeRef}
      data-dnd-slot={`${d}-${meal}`}
      className={`${drop.isOver ? "bg-paper ring-2 ring-ink/50" : ""} ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * A slot of the hero row or the next day's preview. It drags with the mouse
 * only (keyboard drag lives in «La semana», whose tiles are focusable), and
 * only from its own DOM: React events bubble out of the meal sheet's portal,
 * and dragging inside the recipe picker must not move the dish.
 */
function HeroSlot({
  scope,
  d,
  meal,
  slot,
  className = "",
  children,
}: {
  scope: DndScope
  d: number
  meal: MealKey
  slot: MealSlot
  className?: string
  children: ReactNode
}) {
  const { first, drop, drag } = useSlotDnd(scope, d, meal, slot)
  const onPointerDown = drag.listeners?.onPointerDown as ((e: React.PointerEvent) => void) | undefined
  return (
    <div
      ref={(el) => {
        drop.setNodeRef(el)
        drag.setNodeRef(el)
      }}
      data-dnd-slot={`${d}-${meal}`}
      onPointerDown={
        first && onPointerDown
          ? (e) => {
              if (e.currentTarget.contains(e.target as Node)) onPointerDown(e)
            }
          : undefined
      }
      onClickCapture={swallowClickAfterDrag}
      className={`relative transition-opacity ${drag.isDragging ? "opacity-30" : ""} ${
        drop.isOver ? "ring-2 ring-ink/50 ring-offset-4 ring-offset-cream" : ""
      } ${className}`}
    >
      {children}
    </div>
  )
}

/* ── Right column of the hero row: the day's other meals. */
function SideMeal({
  d,
  meal,
  slot,
  big,
  slotProps,
  readOnly,
}: {
  d: number
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
    return (
      <HeroSlot scope="hero" d={d} meal={meal} slot={slot} className="rounded-2xl">
        <EmptyMealCard {...props} readOnly={readOnly} compact />
      </HeroSlot>
    )
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
    <HeroSlot scope="hero" d={d} meal={meal} slot={slot} className={big ? "rounded-[20px]" : "rounded-xl"}>
      {first ? (
        <Link
          href={slotRecipeHref(first.recipeId, props.ctx)}
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
    </HeroSlot>
  )
}

/** The following day, at the bottom of the hero row: clicking it shows that day. */
function NextDayPreview({
  weekStart,
  day,
  isTomorrow,
  slots,
  absent,
  skipped,
  onShow,
}: {
  weekStart: string
  day: number
  isTomorrow: boolean
  slots: DaySlot[]
  absent: MealKey[]
  skipped: boolean
  onShow: () => void
}) {
  const name = weekdayName(day)
  const label = isTomorrow ? `Mañana, ${name}` : `${name.charAt(0).toUpperCase()}${name.slice(1)} ${dateOfDay(weekStart, day).getDate()}`
  const filled = slots.filter((s) => firstRecipeDish(s.slot))
  return (
    <div data-testid="next-day-preview" className="flex flex-col gap-2.5 border-t border-border pt-3.5">
      <button
        type="button"
        onClick={onShow}
        className="cursor-pointer self-start rounded-full text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
      >
        {label}
      </button>
      {skipped ? (
        <p className="text-[15px] italic text-ink-soft">Sin cocinar.</p>
      ) : filled.length === 0 && absent.length === 0 ? (
        <p className="text-[15px] italic text-ink-soft">Aún sin platos.</p>
      ) : (
        DAY_MEAL_ORDER.map((meal) => {
          const s = filled.find((f) => f.meal === meal)
          if (!s) {
            return absent.includes(meal) ? (
              <SlotDrop key={meal} scope="next" d={day} meal={meal} className="rounded-xl">
                <p className="py-1 text-[15px] text-ink-soft">
                  <strong className="font-semibold text-ink">{mealLabel(meal)}:</strong> <span className="italic">no hay</span>
                </p>
              </SlotDrop>
            ) : null
          }
          const r = firstRecipeDish(s.slot)!
          return (
            <HeroSlot key={meal} scope="next" d={day} meal={meal} slot={s.slot} className="rounded-xl">
              <button
                type="button"
                onClick={onShow}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl text-left text-[15px] text-ink hover:text-terracotta-deep focus-visible:outline-2 focus-visible:outline-ink"
              >
                <RecipeCover src={r.imageUrl} name={r.recipeName ?? ""} meal={meal} className="h-[52px] w-[52px] shrink-0 rounded-xl" />
                <span>
                  <strong className="font-semibold">{mealLabel(meal)}:</strong> {r.recipeName}
                </span>
              </button>
            </HeroSlot>
          )
        })
      )}
    </div>
  )
}

/* ─────────────────────────── La semana ─────────────────────────── */

function WeekColumns(p: Props) {
  return (
    <section aria-labelledby="la-semana" className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between">
        <h2 id="la-semana" className="font-serif-text text-[26px] font-medium italic text-ink">
          La semana
        </h2>
        {!p.readOnly && <span className="text-[13px] text-ink-muted">Arrastra un plato para cambiarlo de día o de comida</span>}
      </div>
      <div className="grid grid-cols-7 gap-3.5" data-testid="week-columns">
        {p.days.map((day, d) => (
          <DayColumn key={d} d={d} day={day} {...p} />
        ))}
      </div>
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
  const absent = absentMeals(p.days, d, p.skippedDays)
  // The other meals and the absent ones («Comida: no hay»), in the order of the day.
  const lines = DAY_MEAL_ORDER.filter((m) => m !== tile?.meal && (day?.[m] != null || absent.includes(m)))
  const slotProps = p.slotPropsFor(d)
  const dayName = weekdayName(d)
  const show = () => p.onSelectDay(d)
  // Hovering (or focusing) a line shows its dish's photo on the tile; not mid-drag.
  const [hovered, setHovered] = useState<MealKey | null>(null)
  const { active } = useDndContext()
  const peek = active ? null : hovered
  const peeks = lines.flatMap((m) => {
    const r = firstRecipeDish(day?.[m])
    return r ? [{ meal: m, src: r.imageUrl ?? null }] : []
  })

  return (
    <div
      className={`-m-2 flex min-w-0 flex-col gap-2 rounded-2xl p-2 transition-colors ${isSelected ? "bg-cream-deep" : "hover:bg-cream-deep/50"}`}
      data-day-column={d}
    >
      <button
        type="button"
        onClick={show}
        aria-pressed={isSelected}
        className={`min-h-[32px] cursor-pointer self-start rounded-full text-left text-[13px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ink ${
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
          {tile && (
            <SlotTile d={d} s={tile} slotProps={slotProps} readOnly={p.readOnly} onShow={show} peeks={peeks} peek={peek} />
          )}
          {lines.map((m) => {
            const slot = day?.[m]
            return slot ? (
              <SlotLine
                key={m}
                d={d}
                s={{ meal: m, slot }}
                slotProps={slotProps}
                readOnly={p.readOnly}
                onShow={show}
                onPeek={(on) => setHovered((cur) => (on ? m : cur === m ? null : cur))}
              />
            ) : (
              <SlotDrop key={m} scope="week" d={d} meal={m} className="rounded-lg">
                <button
                  type="button"
                  onClick={show}
                  data-absent-meal={m}
                  aria-label={`${mealLabel(m)}: no hay. Ver el ${dayName}`}
                  className="min-h-[36px] w-full cursor-pointer py-1 text-left text-[13px] leading-[1.3] text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
                >
                  {mealLabel(m)}: <span className="italic">no hay</span>
                </button>
              </SlotDrop>
            )
          })}
          {!tile && lines.length === 0 && (
            <button
              type="button"
              onClick={show}
              className="cursor-pointer self-start text-[13px] italic text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              Sin comidas
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Keep Enter/Space on inner links & buttons from starting a keyboard drag. */
const stopKeys = { onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() }

interface SlotCellProps {
  d: number
  s: DaySlot
  slotProps: SlotPropsFn
  readOnly: boolean
  /** Show this day in the hero row (the recipe opens from there). */
  onShow: () => void
}

function SlotTile({
  d,
  s,
  slotProps,
  readOnly,
  onShow,
  peeks,
  peek,
}: SlotCellProps & { peeks: { meal: MealKey; src: string | null }[]; peek: MealKey | null }) {
  const ctl = useMealOptions()
  const props = slotProps(s.meal, s.slot)
  const { first, drop, drag } = useSlotDnd("week", d, s.meal, s.slot)
  const empty = (s.slot.dishes ?? []).length === 0
  const title = first?.recipeName ?? (s.slot.dishes ?? []).map((x) => (x.kind === "note" ? x.text : "")).join(", ")
  const cover = (
    <span className="relative block">
      <RecipeCover src={first?.imageUrl} name={title} meal={s.meal} className="h-[118px] w-full rounded-[14px]" />
      {/* The photo of the line under the pointer (Miguel, 2026-10-19). */}
      {peeks.map((pk) => (
        <span
          key={pk.meal}
          aria-hidden="true"
          data-peek={pk.meal}
          className={`pointer-events-none absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none ${
            peek === pk.meal ? "opacity-100" : "opacity-0"
          }`}
        >
          <RecipeCover src={pk.src} name="" meal={pk.meal} className="h-full w-full rounded-[14px]" />
        </span>
      ))}
    </span>
  )

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
      onClickCapture={swallowClickAfterDrag}
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
        <button
          type="button"
          onClick={onShow}
          {...stopKeys}
          aria-label={`${mealLabel(s.meal)}: ${title}. Ver el ${weekdayName(d)}`}
          className="flex cursor-pointer flex-col gap-2 text-left text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {cover}
          {/* Which meal it is: a dinner on a day without lunch mustn't pass for lunch. */}
          <span className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{mealLabel(s.meal)}</span>
            <span className="font-serif-text text-[15px] font-[650] leading-[1.2] [text-wrap:pretty]">{title}</span>
          </span>
        </button>
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

function SlotLine({
  d,
  s,
  slotProps,
  readOnly,
  onShow,
  onPeek,
}: SlotCellProps & { onPeek: (on: boolean) => void }) {
  const ctl = useMealOptions()
  const props = slotProps(s.meal, s.slot)
  const { first, drop, drag } = useSlotDnd("week", d, s.meal, s.slot)
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
      onClickCapture={swallowClickAfterDrag}
      onMouseEnter={() => onPeek(true)}
      onMouseLeave={() => onPeek(false)}
      onFocus={() => onPeek(true)}
      onBlur={() => onPeek(false)}
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
      ) : (
        <button
          type="button"
          onClick={onShow}
          {...stopKeys}
          aria-label={`${mealLabel(s.meal)}: ${text}. Ver el ${weekdayName(d)}`}
          className="flex-1 cursor-pointer py-1 text-left text-[13px] leading-[1.3] text-ink-mid hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [@media(hover:none)]:pr-8"
        >
          {props.ctx.isLocked && <Lock size={10} className="mr-1 inline" aria-label="Fijada" />}
          {mealLabel(s.meal)}: {first ? text : <span className="italic">{text}</span>}
        </button>
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
