"use client"

/**
 * Everything you can do to one meal slot of the menu, behind a single "···"
 * button (2026-10-08 redesign). PRO-1175 (2026-11-11, E-72): the first level
 * keeps five or six things and the rest goes to «Más opciones»; which ones
 * show is `mealSheetOptions` (`lib/mealSheet.ts`, tested from the API suite):
 *
 *   - First level: Ver receta, Cambiar plato (the picker, with type chips and
 *     «Que elija Mimoia»), Añadir plato, Marcar como cocinada (today and past
 *     days only), «No la pongas más esta semana» (vetar), Más opciones and,
 *     apart, Quitar comida. A leftover or a táper can't be changed or vetoed.
 *   - Más opciones: Comensales, «Ya está hecho / táper…» (its own sheet),
 *     «Que no cambie si rehago la semana» (the lock) and «Guardar en mi semana
 *     tipo» (its own sheet: the meal's dish types, «Siempre esta receta» or
 *     the written dish, and every other type; PRO-1186).
 *   - Multi-dish or note slot: the dish list (drag to reorder, "Cambiar" per
 *     dish, quitar, edit notes) above the same options (PRO-1176 reworks it).
 *   - The lock never greys anything out (D-182): it only keeps the meal when
 *     the week is redone, and choosing a dish by hand sets it.
 *
 * `useMealOptions()` owns which sheet is open so callers can open one
 * directly: the empty-slot card's main button opens this same sheet
 * (Miguel, 2026-11-05: tapping an empty meal shows the "···" options).
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { menuRecipeHref } from "@/lib/menuReturn"
import {
  Ban,
  BookOpen,
  CalendarDays,
  ChefHat,
  GripVertical,
  Lock,
  Minus,
  MoreHorizontal,
  Plus,
  Replace,
  RotateCcw,
  History,
  Trash2,
  Unlock,
  Users,
  Package,
} from "lucide-react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { type Dish, type MealSlot, type RecipeDish, type WeekTypeOption } from "@ona/shared"
import { everyWeekday, mealSheetOptions, weekTypeChoices, type MealWhen } from "@/lib/mealSheet"
import { DishTypeIcon, iconOfOption } from "@/components/weekType/DishTypeIcon"
import { DishTypeChips } from "@/components/weekType/SlotEditor"
import { mealLabel } from "@/lib/labels"
import { useRecipeCookStats, useRecordCook } from "@/hooks/useCookLogs"
import { useSetSlotEaten } from "@/hooks/useMenu"
import { ConfirmSheet, MenuSheet, SheetAction, useSheetTracker } from "./MenuSheet"
import { trackSheetAction } from "@/lib/usageEvents"
import { RatingPromptSheet } from "@/components/cooking/RatingPromptSheet"
import { RecipePickerSheet } from "./RecipePickerSheet"
import { AddDishSheet } from "./AddDishSheet"
import { DishRow } from "./DishRow"

export type DishPayload =
  | { kind: "recipe"; recipeId: string; variant?: "planned" | "freezer" | "fridge" }
  | { kind: "note"; text: string }

/** Mutations for one (day, meal) slot. Built once per slot by the page. */
export interface SlotHandlers {
  /** «Que elija Mimoia» in the picker (PRO-1175), with the type chip if one is chosen. Rejects when nothing fits. */
  regenerate: (dishType?: string | null) => Promise<unknown>
  pickRecipe: (recipeId: string) => void
  toggleLock: () => void
  remove: () => void
  setServings: (servings: number | null) => void
  ban: (recipeId: string) => void
  addDish: (payload: DishPayload) => void
  addRandomDish: () => void
  removeDish: (position: number) => void
  regenerateDish: (position: number) => void
  reorderDish: (from: number, to: number) => void
  editNote: (position: number, text: string) => void
  /** PRO-74: the slot's dishes become this written dish (a note). */
  replaceWithNote: (text: string) => void
  /** «Son sobras de otro día» / «No son sobras de otro día» on the recipe dish at `position` (2026-10-20). */
  setCooked: (position: number, on: boolean) => void
  /** PRO-223: mark / unmark this meal as the táper of the dinner before. */
  setTaper?: (on: boolean) => void
  /** «Guardar en mi semana tipo» in «Más opciones» (PRO-1186): that day and meal of the household's week type, and this week if it can. */
  saveToWeekType?: (option: WeekTypeOption) => void
}

export interface SlotContext {
  menuId: string
  day: number
  meal: string
  slot: MealSlot
  /** "jueves 8" — shown in the sheet's eyebrow. */
  dayLabel: string
  /** «Que no cambie si rehago la semana»: kept when the week is redone. Never greys the sheet (PRO-1175). */
  isLocked: boolean
  /** Past, today or a day still to come: «Marcar como cocinada» only today and before (PRO-1175). */
  when?: MealWhen
  /** Household diner count used when the slot has no override. */
  defaultDiners: number
  /** Servings the batch cooks, táper included (`batchServings`, PRO-75). */
  batchServings?: number
  /** PRO-223: name of the dinner before («Lentejas», cena del lunes) when this meal can be its táper. */
  taperFrom?: { dayLabel: string; recipeName: string } | null
  isRegenerating?: boolean
  /** Other days eat this slot's leftovers: it's the batch, never a freezer táper. */
  feedsLeftovers?: boolean
}

/** Servings a menu dish opens its recipe / cook mode with (PRO-75). */
export function slotServings(ctx: SlotContext): number {
  return ctx.batchServings ?? ctx.slot.servings ?? ctx.defaultDiners
}

/** Recipe detail link for a menu dish, at the batch's servings (PRO-75); its back button returns here. */
export function slotRecipeHref(recipeId: string, ctx: SlotContext): string {
  return menuRecipeHref(recipeId, slotServings(ctx))
}

type OpenSheet = null | "actions" | "more" | "done" | "weekType" | "picker" | "addDish" | "confirmBan" | "confirmRemove" | "rate"

export function useMealOptions() {
  const [open, setOpen] = useState<OpenSheet>(null)
  return { open, setOpen }
}

export type MealOptionsController = ReturnType<typeof useMealOptions>

/** The visible "···" trigger. */
export function MealOptionsButton({
  ctl,
  label,
  className = "",
}: {
  ctl: MealOptionsController
  /** Accessible name, e.g. "Más opciones de la comida". */
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      // The «Primeros pasos» guide points at this button on the first dish (PRO-68).
      data-meal-options=""
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        ctl.setOpen("actions")
      }}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${className}`}
    >
      <MoreHorizontal size={20} strokeWidth={2} />
    </button>
  )
}

export function MealOptionsSheets({
  ctl,
  ctx,
  handlers,
}: {
  ctl: MealOptionsController
  ctx: SlotContext
  handlers: SlotHandlers
}) {
  const { open, setOpen } = ctl
  const close = useCallback(() => setOpen(null), [setOpen])
  const router = useRouter()
  const dishes: Dish[] = ctx.slot.dishes ?? []
  const first = dishes.find((d): d is RecipeDish => d.kind === "recipe") ?? null
  const isSingleRecipe = dishes.length === 1 && dishes[0].kind === "recipe"
  const opts = mealSheetOptions({
    slot: ctx.slot,
    when: ctx.when ?? "future",
    canTaper: Boolean(handlers.setTaper && ctx.taperFrom),
    feedsLeftovers: ctx.feedsLeftovers,
    canSaveToWeekType: Boolean(handlers.saveToWeekType),
  })
  const has = (o: (typeof opts.first)[number]) => opts.first.includes(o)
  const label = mealLabel(ctx.meal)
  const eyebrow = `${label} · ${ctx.dayLabel}`
  const locked = ctx.isLocked
  // PRO-1174: which sheet this is, for `menu_sheet_action`.
  const sheet = isSingleRecipe ? "comida" : dishes.length === 0 ? "vacio" : "comida_varios"

  return (
    <>
      <MenuSheet
        open={open === "actions"}
        onClose={close}
        eyebrow={eyebrow}
        title={first?.recipeName ?? (dishes.length > 0 ? label : "Sin plato todavía")}
        sheet={sheet}
      >
        {/* PRO-259: why Mimo chose it — only menus from the planner carry it. A grey line, not a card (PRO-1175). */}
        {first?.why && (
          <p data-testid="dish-why" className="-mt-1 mb-3 text-[13.5px] leading-snug text-ink-muted">
            <span className="sr-only">Por qué te lo propongo: </span>
            {first.why}
          </p>
        )}

        {!isSingleRecipe && dishes.length > 0 && (
          <DishList
            dishes={dishes}
            onOpenRecipe={(id) => router.push(menuRecipeHref(id))}
            handlers={handlers}
          />
        )}

        <div className="flex flex-col gap-0.5" data-testid="meal-sheet-first">
          {first && has("ver_receta") && (
            <SheetAction icon={BookOpen} label="Ver receta" action="ver_receta" href={slotRecipeHref(first.recipeId, ctx)} />
          )}
          {has("cambiar_plato") && (
            <SheetAction
              icon={Replace}
              label="Cambiar plato"
              action="elegir_receta"
              hint="Busca, filtra por tipo o deja que elija Mimoia"
              disabled={ctx.isRegenerating}
              onClick={() => setOpen("picker")}
            />
          )}
          <SheetAction
            icon={Plus}
            label="Añadir plato"
            action="anadir_plato"
            hint="Otro plato o una nota en esta comida"
            onClick={() => setOpen("addDish")}
          />
          {first && (has("cocinada") || has("desmarcar_cocinada")) && (
            <CookedAction recipeId={first.recipeId} ctx={ctx} onAskRating={() => setOpen("rate")} onUnmarked={close} />
          )}
          {first && has("vetar") && (
            <SheetAction
              icon={Ban}
              label="No la pongas más esta semana"
              action="vetar"
              hint="Pondremos otra en su lugar"
              onClick={() => setOpen("confirmBan")}
            />
          )}
          <SheetAction
            icon={MoreHorizontal}
            label="Más opciones"
            action="mas_opciones"
            hint={moreHint(opts.more)}
            onClick={() => setOpen("more")}
          />
        </div>

        <div className="mt-1 border-t border-border-soft pt-1">
          <SheetAction
            icon={Trash2}
            label={`Quitar ${label.toLowerCase()}`}
            action="quitar_comida"
            hint="Solo de este día; tus preferencias no cambian"
            destructive
            onClick={() => setOpen("confirmRemove")}
          />
        </div>
      </MenuSheet>

      {/* «Más opciones»: comensales, ya está hecho / táper, que no cambie al rehacer la semana. */}
      <MenuSheet open={open === "more"} onClose={close} eyebrow={eyebrow} title="Más opciones" sheet={sheet}>
        <div className="flex flex-col gap-0.5" data-testid="meal-sheet-more">
          <DinerStepper
            value={ctx.slot.servings ?? null}
            fallback={ctx.defaultDiners}
            onChange={handlers.setServings}
          />
          {opts.more.includes("ya_hecho") && (
            <SheetAction
              icon={Package}
              label="Ya está hecho / táper…"
              action="ya_hecho"
              hint="No suma a la compra"
              onClick={() => setOpen("done")}
            />
          )}
          {opts.more.includes("fijar") && (
            <SheetAction
              icon={locked ? Lock : Unlock}
              label="Que no cambie si rehago la semana"
              action={locked ? "desfijar" : "fijar"}
              hint={locked ? "Sí: se queda aunque rehagas la semana · toca para quitarlo" : "Cambiará si rehaces la semana"}
              pressed={locked}
              testId="meal-keep"
              onClick={() => {
                handlers.toggleLock()
                close()
              }}
            />
          )}
          {opts.more.includes("semana_tipo") && handlers.saveToWeekType && (
            <SheetAction
              icon={CalendarDays}
              label="Guardar en mi semana tipo"
              action="semana_tipo"
              hint={`Lo de esta comida, ${everyWeekday(ctx.day)}`}
              onClick={() => setOpen("weekType")}
            />
          )}
        </div>
      </MenuSheet>

      {/* «Guardar en mi semana tipo» (PRO-1186): what this meal is, or another type. */}
      {handlers.saveToWeekType && (
        <WeekTypeSaveSheet
          open={open === "weekType"}
          onClose={close}
          eyebrow={eyebrow}
          sheet={sheet}
          intro={`${capitalise(everyWeekday(ctx.day))}, ${label.toLowerCase()}: todas las semanas.`}
          slot={ctx.slot}
          onSave={(option) => {
            handlers.saveToWeekType?.(option)
            close()
          }}
        />
      )}

      {/* «Ya está hecho / táper…»: lo que no se compra. */}
      <MenuSheet open={open === "done"} onClose={close} eyebrow={eyebrow} title="Ya está hecho / táper" sheet={sheet}>
        <div className="flex flex-col gap-0.5">
          {opts.done.includes("sobras_si") && (
            <SheetAction
              icon={History}
              label="Lo tengo hecho (nevera, congelador…)"
              action="sobras_si"
              hint="No suma a la compra"
              onClick={() => {
                handlers.setCooked(0, true)
                close()
              }}
            />
          )}
          {opts.done.includes("sobras_no") && (
            <SheetAction
              icon={History}
              label="No lo tengo hecho"
              action="sobras_no"
              hint="Vuelve a sumar a la compra"
              onClick={() => {
                handlers.setCooked(0, false)
                close()
              }}
            />
          )}
          {opts.done.includes("taper_si") && ctx.taperFrom && (
            <SheetAction
              icon={Package}
              label="Sobras de la cena de ayer"
              action="taper_si"
              hint={`${ctx.taperFrom.recipeName}, cena del ${ctx.taperFrom.dayLabel}: se hace una ración más`}
              onClick={() => {
                handlers.setTaper?.(true)
                close()
              }}
            />
          )}
          {opts.done.includes("taper_no") && (
            <SheetAction
              icon={Package}
              label="Quitar táper"
              action="taper_no"
              hint="La comida queda vacía para poner otra cosa"
              onClick={() => {
                handlers.setTaper?.(false)
                close()
              }}
            />
          )}
        </div>
      </MenuSheet>

      {first && (
        <RatingPromptSheet
          recipeId={open === "rate" ? first.recipeId : null}
          recipeName={first.recipeName}
          onDone={close}
        />
      )}
      {first && (
        <ConfirmSheet
          open={open === "confirmBan"}
          onClose={close}
          onConfirm={() => handlers.ban(first.recipeId)}
          eyebrow={eyebrow}
          title={`¿No poner «${first.recipeName ?? "esta receta"}» más esta semana?`}
          message="Pondremos otra receta en su lugar y no volverá a salir esta semana."
          confirmLabel="No ponerla"
        />
      )}
      <ConfirmSheet
        open={open === "confirmRemove"}
        onClose={close}
        onConfirm={handlers.remove}
        eyebrow={eyebrow}
        title={`¿Quitar ${label.toLowerCase()} de este día?`}
        message="Solo de este día; tus preferencias no cambian."
        confirmLabel="Quitar"
      />

      {typeof document !== "undefined" &&
        createPortal(
          <>
            <RecipePickerSheet
              open={open === "picker"}
              onClose={close}
              title={`${label} del día`}
              subtitle={first?.recipeName ? `Ahora: ${first.recipeName}` : "Sin plato"}
              onPick={(picked) => {
                handlers.pickRecipe(picked.id)
                close()
              }}
              onUseText={(text) => {
                handlers.replaceWithNote(text)
                close()
              }}
              // PRO-1175: the random swap lives here now; it counts as `cambiar_azar`, as it did.
              onPickAuto={async (dishType) => {
                trackSheetAction(sheet, "cambiar_azar")
                await handlers.regenerate(dishType)
                close()
              }}
            />
            <AddDishSheet
              open={open === "addDish"}
              onClose={close}
              slotLabel={`${label} del día`}
              onPickAleatorio={handlers.addRandomDish}
              onPickRecipe={(recipeId) => handlers.addDish({ kind: "recipe", recipeId })}
              onAddNote={(text) => handlers.addDish({ kind: "note", text })}
            />
          </>,
          document.body,
        )}
    </>
  )
}

/** The hint of «Más opciones»: what's inside, in a few words. */
function moreHint(more: readonly string[]): string {
  const parts = ["Comensales"]
  if (more.includes("ya_hecho")) parts.push("ya está hecho")
  if (more.includes("fijar")) parts.push("que no cambie")
  if (more.includes("semana_tipo")) parts.push("semana tipo")
  return parts.join(", ")
}

const capitalise = (s: string) => (s ? s[0].toLocaleUpperCase("es") + s.slice(1) : s)

/* ── «Guardar en mi semana tipo» (PRO-1186): the meal's dish types, «Siempre
 *    esta receta» or the written dish (`weekTypeChoices`), and «Otro tipo de
 *    plato» with every type by family. */
function WeekTypeSaveSheet({
  open,
  onClose,
  eyebrow,
  sheet,
  intro,
  slot,
  onSave,
}: {
  open: boolean
  onClose: () => void
  eyebrow: string
  sheet: React.ComponentProps<typeof MenuSheet>["sheet"]
  intro: string
  slot: MealSlot
  onSave: (option: WeekTypeOption) => void
}) {
  const choices = useMemo(() => weekTypeChoices(slot).map((c) => ({ ...c, Icon: iconFor(iconOfOption(c.option)) })), [slot])
  const [others, setOthers] = useState(false)
  useEffect(() => {
    if (!open) setOthers(false)
  }, [open])
  const showTypes = others || choices.length === 0
  return (
    <MenuSheet open={open} onClose={onClose} eyebrow={eyebrow} title="Guardar en mi semana tipo" sheet={sheet}>
      <p className="-mt-1 mb-3 text-[13.5px] leading-snug text-ink-muted">{intro}</p>
      <div className="flex flex-col gap-0.5" data-testid="week-type-choices">
        {choices.map((c, i) => (
          <SheetAction key={i} icon={c.Icon} label={c.label} hint={c.hint} onClick={() => onSave(c.option)} />
        ))}
        {choices.length > 0 && !others && (
          <SheetAction icon={MoreHorizontal} label="Otro tipo de plato" hint="Legumbres, pescado, pizza…" onClick={() => setOthers(true)} />
        )}
      </div>
      {showTypes && (
        <div className="mt-3 space-y-4" data-testid="week-type-all-types">
          <DishTypeChips onPick={(type) => onSave({ kind: "type", type })} />
        </div>
      )}
    </MenuSheet>
  )
}

/** A `DishTypeIcon` with the props `SheetAction` passes to its icon. */
function iconFor(type: string) {
  return function WeekTypeOptionIcon({ size, className }: { size?: number; className?: string }) {
    return <DishTypeIcon type={type} size={size} className={className} />
  }
}

/* ── "Marcar como cocinada" — records a cook event with the slot as context
 *    and marks the slot eaten (PRO-185), so the card shows «✓ Comido». An
 *    eaten slot (also when Mimo marked it) offers «Desmarcar» instead. */
function CookedAction({
  recipeId,
  ctx,
  onAskRating,
  onUnmarked,
}: {
  recipeId: string
  ctx: SlotContext
  onAskRating: () => void
  onUnmarked: () => void
}) {
  const { data } = useRecipeCookStats(recipeId)
  const record = useRecordCook()
  const setEaten = useSetSlotEaten()
  const count = data?.count ?? 0
  const slotKey = { menuId: ctx.menuId, day: ctx.day, meal: ctx.meal }
  if (ctx.slot.eaten) {
    return (
      <SheetAction
        icon={RotateCcw}
        label={setEaten.isPending ? "Guardando…" : "Desmarcar"}
        action="desmarcar_cocinada"
        hint="Comido · vuelve a quedar por cocinar"
        disabled={setEaten.isPending}
        onClick={() => setEaten.mutate({ ...slotKey, eaten: false }, { onSuccess: onUnmarked })}
      />
    )
  }
  return (
    <SheetAction
      icon={ChefHat}
      label={record.isPending ? "Guardando…" : "Marcar como cocinada"}
      action="cocinada"
      hint={count > 0 ? `La has cocinado ${count} ${count === 1 ? "vez" : "veces"}` : undefined}
      disabled={record.isPending}
      onClick={() => {
        setEaten.mutate({ ...slotKey, eaten: true })
        record.mutate(
          { recipeId, menuId: ctx.menuId, dayIndex: ctx.day, meal: ctx.meal },
          // «¿Qué tal?» (PRO-110) replaces this sheet when the API asks for it.
          { onSuccess: (res) => res.askRating && onAskRating() },
        )
      }}
    />
  )
}

/* ── Dishes of a multi-dish / note slot: drag to reorder, cambiar, quitar, notes. */
function DishList({
  dishes,
  onOpenRecipe,
  handlers,
}: {
  dishes: Dish[]
  onOpenRecipe: (recipeId: string) => void
  handlers: SlotHandlers
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = dishes.map((_, i) => `dish-${i}`)
  const track = useSheetTracker()
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const from = ids.indexOf(String(e.active.id))
    const to = ids.indexOf(String(e.over.id))
    if (from >= 0 && to >= 0) {
      track("ordenar_platos")
      handlers.reorderDish(from, to)
    }
  }
  return (
    <div className="mb-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Platos</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {dishes.map((dish, i) => (
              <SortableDish
                key={ids[i]}
                id={ids[i]}
                dish={dish}
                // PRO-1174: each dish's own options count as the `plato` sheet.
                onClickThumb={
                  dish.kind === "recipe"
                    ? () => {
                        trackSheetAction("plato", "ver_receta")
                        onOpenRecipe(dish.recipeId)
                      }
                    : undefined
                }
                onRegenerate={
                  dish.kind === "recipe"
                    ? () => {
                        trackSheetAction("plato", "cambiar_azar")
                        handlers.regenerateDish(i)
                      }
                    : undefined
                }
                onRemove={() => {
                  trackSheetAction("plato", "quitar_plato")
                  handlers.removeDish(i)
                }}
                onSaveNote={
                  dish.kind === "note"
                    ? (text) => {
                        trackSheetAction("plato", "editar_nota")
                        handlers.editNote(i, text)
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableDish({
  id,
  dish,
  onClickThumb,
  onRegenerate,
  onRemove,
  onSaveNote,
}: {
  id: string
  dish: Dish
  onClickThumb?: () => void
  onRegenerate?: () => void
  onRemove?: () => void
  onSaveNote?: (text: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-1"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Arrastrar para reordenar"
        className="flex h-11 w-8 shrink-0 cursor-grab items-center justify-center text-ink-light touch-none"
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <DishRow
          dish={dish}
          onClickThumb={onClickThumb}
          onRegenerate={onRegenerate}
          onRemove={onRemove}
          onSaveNote={onSaveNote}
        />
      </div>
    </div>
  )
}

/* ── Per-slot diner override. `null` = no override (household default).
 *    The number is in the text («Comensales: 4», PRO-1175). */
function DinerStepper({
  value,
  fallback,
  onChange,
}: {
  value: number | null
  fallback: number
  onChange: (next: number | null) => void
}) {
  const effective = value ?? fallback
  const hasOverride = value != null
  const clamp = (n: number) => Math.max(1, Math.min(24, n))
  const track = useSheetTracker()
  return (
    <div className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl px-3">
      <div className="flex items-center gap-3.5 text-ink">
        <Users size={20} strokeWidth={1.7} />
        <div>
          <p className="text-[15px] font-medium leading-tight" aria-live="polite" data-testid="diners-label">
            Comensales: {effective}
          </p>
          <p className="text-[12.5px] text-ink-soft">
            {hasOverride ? "Solo hoy" : "Los de tu casa"}
            {hasOverride && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => {
                    track("comensales_quitar")
                    onChange(null)
                  }}
                  className="underline underline-offset-2 hover:text-terracotta-deep"
                >
                  Quitar
                </button>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Menos comensales"
          disabled={effective <= 1}
          onClick={() => {
            track("comensales_menos")
            onChange(clamp(effective - 1))
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:bg-cream-deep disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          aria-label="Más comensales"
          disabled={effective >= 24}
          onClick={() => {
            track("comensales_mas")
            onChange(clamp(effective + 1))
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:bg-cream-deep disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}
