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
 *   - Multi-dish or note slot (PRO-1176): the title is the meal («Comida ·
 *     jueves 13», «2 platos · 3 comensales»); each dish is a row (a tap opens
 *     the recipe, drag ⠿ to reorder) with its own «···», the dish's sheet:
 *     Ver receta, Cambiar este plato (the same picker, on that dish only),
 *     Ya está hecho / táper, No lo pongas más esta semana and Quitar este
 *     plato (a note: Editar nota, Quitar nota). Below, what belongs to the
 *     meal: Añadir plato, Marcar la comida como cocinada (all its recipes),
 *     Más opciones and Quitar comida (`dishSheetOptions`, `lib/mealSheet.ts`).
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
  Pencil,
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
import {
  dishSheetOptions,
  everyWeekday,
  isMultiDishMeal,
  mealCookRecipeIds,
  mealSheetHeading,
  mealSheetOptions,
  weekTypeChoices,
  type DishSheetOption,
  type MealWhen,
} from "@/lib/mealSheet"
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
import { DishRow, courseLabel, dishName } from "./DishRow"

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
  /** «Que elija Mimoia» in a dish's picker (PRO-1176), with the type chip if one is chosen. Rejects when nothing fits. */
  regenerateDish: (position: number, dishType?: string | null) => Promise<unknown>
  /** «Cambiar este plato» (PRO-1176): the picker's recipe on that dish only. */
  pickDishRecipe: (position: number, recipeId: string) => void
  /** «No lo pongas más esta semana» on one dish (PRO-1176): vetoed for the week, another in its place. */
  banDish: (position: number, recipeId: string) => void
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

type OpenSheet =
  | null
  | "actions"
  | "more"
  | "done"
  | "weekType"
  | "picker"
  | "addDish"
  | "confirmBan"
  | "confirmRemove"
  | "rate"
  // PRO-1176: the «···» of one dish of a multi-dish meal, its picker and its veto.
  | "dish"
  | "dishPicker"
  | "confirmBanDish"

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
  const multi = isMultiDishMeal(ctx.slot)
  const heading = mealSheetHeading({ slot: ctx.slot, mealLabel: label, dayLabel: ctx.dayLabel, diners: ctx.defaultDiners })
  // PRO-1174: which sheet this is, for `menu_sheet_action`.
  const sheet = isSingleRecipe ? "comida" : dishes.length === 0 ? "vacio" : "comida_varios"
  // PRO-1176: the dish whose «···» is open, and the recipe «¿Qué tal?» asks about.
  const [dishAt, setDishAt] = useState<number | null>(null)
  const dish = dishAt != null ? dishes[dishAt] ?? null : null
  const [rateId, setRateId] = useState<string | null>(null)
  const rateDish = dishes.find((d): d is RecipeDish => d.kind === "recipe" && d.recipeId === rateId) ?? first
  const openDish = (position: number) => {
    setDishAt(position)
    setOpen("dish")
  }

  return (
    <>
      <MenuSheet open={open === "actions"} onClose={close} eyebrow={heading.eyebrow} title={heading.title} sheet={sheet}>
        {heading.subtitle && (
          <p data-testid="meal-sheet-subtitle" className="-mt-1 mb-3 text-[13.5px] leading-snug text-ink-muted">
            {heading.subtitle}
          </p>
        )}
        {/* PRO-259: why Mimo chose it — only menus from the planner carry it. A grey line, not a card (PRO-1175). */}
        {!multi && first?.why && (
          <p data-testid="dish-why" className="-mt-1 mb-3 text-[13.5px] leading-snug text-ink-muted">
            <span className="sr-only">Por qué te lo propongo: </span>
            {first.why}
          </p>
        )}

        {multi && (
          <DishList
            dishes={dishes}
            onOpenRecipe={(id) => router.push(slotRecipeHref(id, ctx))}
            onOptions={openDish}
            onReorder={handlers.reorderDish}
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
            <CookedAction
              recipeIds={multi ? mealCookRecipeIds(ctx.slot) : [first.recipeId]}
              label={multi ? `Marcar la ${label.toLowerCase()} como cocinada` : "Marcar como cocinada"}
              ctx={ctx}
              onAskRating={(recipeId) => {
                setRateId(recipeId)
                setOpen("rate")
              }}
              onUnmarked={close}
            />
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

      {rateDish && (
        <RatingPromptSheet
          recipeId={open === "rate" ? rateDish.recipeId : null}
          recipeName={rateDish.recipeName}
          onDone={close}
        />
      )}

      {/* PRO-1176: the «···» of one dish of a multi-dish meal. */}
      <DishSheet
        open={open === "dish"}
        onClose={close}
        eyebrow={eyebrow}
        dish={dish}
        recipeHref={dish?.kind === "recipe" ? slotRecipeHref(dish.recipeId, ctx) : undefined}
        options={dish ? dishSheetOptions(dish, { feedsLeftovers: ctx.feedsLeftovers }) : []}
        disabled={ctx.isRegenerating}
        onChange={() => setOpen("dishPicker")}
        onCooked={(on) => {
          if (dishAt != null) handlers.setCooked(dishAt, on)
          close()
        }}
        onBan={() => setOpen("confirmBanDish")}
        onRemove={() => {
          if (dishAt != null) handlers.removeDish(dishAt)
          close()
        }}
        onSaveNote={(text) => {
          if (dishAt != null) handlers.editNote(dishAt, text)
          close()
        }}
      />
      {dish?.kind === "recipe" && (
        <ConfirmSheet
          open={open === "confirmBanDish"}
          onClose={close}
          onConfirm={() => dishAt != null && handlers.banDish(dishAt, dish.recipeId)}
          eyebrow={eyebrow}
          title={`¿No poner «${dish.recipeName ?? "esta receta"}» más esta semana?`}
          message="Pondremos otra receta en su lugar y no volverá a salir esta semana."
          confirmLabel="No ponerla"
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
            {/* PRO-1176: «Cambiar este plato» — the same picker, on that dish only. */}
            <RecipePickerSheet
              open={open === "dishPicker"}
              onClose={close}
              title={`${(dish && courseLabel(dish)) ?? "Plato"} · ${label.toLowerCase()} del día`}
              subtitle={dish ? `Ahora: ${dishName(dish)}` : undefined}
              onPick={(picked) => {
                trackSheetAction("plato", "elegir_receta")
                if (dishAt != null) handlers.pickDishRecipe(dishAt, picked.id)
                close()
              }}
              onPickAuto={async (dishType) => {
                trackSheetAction("plato", "cambiar_azar")
                if (dishAt != null) await handlers.regenerateDish(dishAt, dishType)
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
 *    eaten slot (also when Mimo marked it) offers «Desmarcar» instead. With
 *    several dishes, «Marcar la comida como cocinada» records every recipe of
 *    the meal (PRO-1176); «¿Qué tal?» asks about the first the API asks for. */
function CookedAction({
  recipeIds,
  label,
  ctx,
  onAskRating,
  onUnmarked,
}: {
  recipeIds: string[]
  label: string
  ctx: SlotContext
  onAskRating: (recipeId: string) => void
  onUnmarked: () => void
}) {
  const single = recipeIds.length === 1
  const { data } = useRecipeCookStats(single ? recipeIds[0] : undefined)
  const record = useRecordCook()
  const setEaten = useSetSlotEaten()
  const [saving, setSaving] = useState(false)
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
      label={saving ? "Guardando…" : label}
      action="cocinada"
      hint={single ? (count > 0 ? `La has cocinado ${count} ${count === 1 ? "vez" : "veces"}` : undefined) : `Apunta sus ${recipeIds.length} recetas`}
      disabled={saving}
      onClick={async () => {
        setEaten.mutate({ ...slotKey, eaten: true })
        setSaving(true)
        try {
          const results = await Promise.allSettled(
            recipeIds.map((recipeId) => record.mutateAsync({ recipeId, menuId: ctx.menuId, dayIndex: ctx.day, meal: ctx.meal })),
          )
          // «¿Qué tal?» (PRO-110) replaces this sheet when the API asks for it.
          const ask = results.findIndex((r) => r.status === "fulfilled" && r.value.askRating)
          if (ask >= 0) onAskRating(recipeIds[ask])
        } finally {
          setSaving(false)
        }
      }}
    />
  )
}

/* ── Dishes of a multi-dish / note slot (PRO-1176): a row per dish, drag ⠿ to
 *    reorder; a tap opens the recipe and its «···» opens the dish's sheet. */
function DishList({
  dishes,
  onOpenRecipe,
  onOptions,
  onReorder,
}: {
  dishes: Dish[]
  onOpenRecipe: (recipeId: string) => void
  onOptions: (position: number) => void
  onReorder: (from: number, to: number) => void
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
      onReorder(from, to)
    }
  }
  return (
    <div className="mb-3" data-testid="meal-dishes">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {dishes.map((dish, i) => (
              <SortableDish
                key={ids[i]}
                id={ids[i]}
                dish={dish}
                // PRO-1174: each dish's own options count as the `plato` sheet.
                onOpen={
                  dish.kind === "recipe"
                    ? () => {
                        trackSheetAction("plato", "ver_receta")
                        onOpenRecipe(dish.recipeId)
                      }
                    : undefined
                }
                onOptions={() => onOptions(i)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableDish({ id, dish, onOpen, onOptions }: { id: string; dish: Dish; onOpen?: () => void; onOptions: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-1"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Arrastrar para ordenar: ${dishName(dish)}`}
        className="flex h-11 w-8 shrink-0 cursor-grab items-center justify-center text-ink-light touch-none"
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <DishRow dish={dish} onOpen={onOpen} onOptions={onOptions} />
      </div>
    </li>
  )
}

/* ── The dish's sheet (PRO-1176): what is of that dish only. A recipe: Ver
 *    receta, Cambiar este plato, Ya está hecho / táper (or back to the list),
 *    No lo pongas más esta semana, Quitar este plato. A note: editar, quitar. */
function DishSheet({
  open,
  onClose,
  eyebrow,
  dish,
  recipeHref,
  options,
  disabled,
  onChange,
  onCooked,
  onBan,
  onRemove,
  onSaveNote,
}: {
  open: boolean
  onClose: () => void
  eyebrow: string
  dish: Dish | null
  recipeHref?: string
  options: DishSheetOption[]
  disabled?: boolean
  onChange: () => void
  onCooked: (on: boolean) => void
  onBan: () => void
  onRemove: () => void
  onSaveNote: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState("")
  useEffect(() => {
    if (!open) setEditing(false)
  }, [open])
  const has = (o: DishSheetOption) => options.includes(o)
  const course = dish ? courseLabel(dish) : null
  const isNote = dish?.kind === "note"
  return (
    <MenuSheet
      open={open && dish != null}
      onClose={onClose}
      eyebrow={course ? `${course} · ${eyebrow}` : eyebrow}
      title={dish ? dishName(dish) : ""}
      sheet="plato"
    >
      <div className="flex flex-col gap-0.5" data-testid="dish-sheet">
        {has("ver_receta") && recipeHref && <SheetAction icon={BookOpen} label="Ver receta" action="ver_receta" href={recipeHref} />}
        {has("cambiar_plato") && (
          <SheetAction
            icon={Replace}
            label="Cambiar este plato"
            action="elegir_receta"
            hint="Busca, filtra por tipo o deja que elija Mimoia"
            disabled={disabled}
            onClick={onChange}
          />
        )}
        {has("ya_hecho") && (
          <SheetAction
            icon={Package}
            label="Ya está hecho / táper"
            action="sobras_si"
            hint="Lo tengo hecho (nevera, congelador…): no suma a la compra"
            onClick={() => onCooked(true)}
          />
        )}
        {has("no_hecho") && (
          <SheetAction icon={History} label="No lo tengo hecho" action="sobras_no" hint="Vuelve a sumar a la compra" onClick={() => onCooked(false)} />
        )}
        {has("vetar") && (
          <SheetAction icon={Ban} label="No lo pongas más esta semana" action="vetar" hint="Pondremos otro en su lugar" onClick={onBan} />
        )}
        {has("editar_nota") && isNote && !editing && (
          <SheetAction
            icon={Pencil}
            label="Editar nota"
            hint="«Pan», «cenamos fuera»…"
            onClick={() => {
              setText(dish.text)
              setEditing(true)
            }}
          />
        )}
        {editing && (
          <form
            className="flex items-center gap-2 px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault()
              const t = text.trim().slice(0, 120)
              if (t) {
                trackSheetAction("plato", "editar_nota")
                onSaveNote(t)
              }
            }}
          >
            <input
              autoFocus
              aria-label="Nota"
              value={text}
              maxLength={120}
              onChange={(e) => setText(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-border bg-paper px-3 py-2.5 text-[15px] text-ink focus:border-ink focus:outline-none"
            />
            <button
              type="submit"
              className="h-11 shrink-0 rounded-full bg-ink px-5 text-[14px] font-semibold text-cream transition-colors hover:bg-forest"
            >
              Guardar
            </button>
          </form>
        )}
      </div>
      {has("quitar_plato") && (
        <div className="mt-1 border-t border-border-soft pt-1">
          <SheetAction
            icon={Trash2}
            label={isNote ? "Quitar nota" : "Quitar este plato"}
            action="quitar_plato"
            hint="El resto de la comida se queda"
            destructive
            onClick={onRemove}
          />
        </div>
      )}
    </MenuSheet>
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
