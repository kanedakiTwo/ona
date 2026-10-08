"use client"

/**
 * Everything you can do to one meal slot of the menu, behind a single "···"
 * button (2026-10-08 redesign). Before, each meal card showed 3–6 chips
 * (Elegir, Cambiar, Tipo, Vetar, Añadir plato, Fijar, Quitar, Comensales,
 * Cocinada…); now they live in one sheet, with the same rules:
 *
 *   - Single-recipe slot: Ver receta, Elegir otra receta, Cambiar al azar,
 *     Añadir plato, Tipo de comida, Fijar, Vetar, Comensales, Marcar como
 *     cocinada, Quitar comida.
 *   - Leftover ("sobras"): no Elegir / Cambiar / Tipo / Vetar (tied to its
 *     source slot).
 *   - Multi-dish or note slot: the dish list (drag to reorder, "Cambiar" per
 *     dish, quitar, edit notes) + Añadir plato, Fijar, Comensales, Quitar.
 *   - Empty slot: Añadir plato, Fijar, Comensales, Quitar comida.
 *   - Locked ("Fijada"): every change is disabled except Desfijar.
 *
 * `useMealOptions()` owns which sheet is open so callers can open the
 * "Añadir plato" sheet directly (the empty-slot card's main button).
 */
import { useCallback, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import {
  Ban,
  BookOpen,
  ChefHat,
  GripVertical,
  Lock,
  Minus,
  MoreHorizontal,
  Plus,
  Replace,
  Shuffle,
  Tag,
  Trash2,
  Unlock,
  Users,
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
import { MEAL_TYPE_TAGS, MEAL_TYPE_TAG_LABELS, type Dish, type MealSlot, type RecipeDish } from "@ona/shared"
import { mealLabel } from "@/lib/labels"
import { useRecipeCookStats, useRecordCook } from "@/hooks/useCookLogs"
import { MenuSheet, SheetAction } from "./MenuSheet"
import { RecipePickerSheet } from "./RecipePickerSheet"
import { AddDishSheet } from "./AddDishSheet"
import { DishRow } from "./DishRow"

export type DishPayload = { kind: "recipe"; recipeId: string } | { kind: "note"; text: string }

/** Mutations for one (day, meal) slot. Built once per slot by the page. */
export interface SlotHandlers {
  regenerate: () => void
  pickRecipe: (recipeId: string) => void
  toggleLock: () => void
  remove: () => void
  setServings: (servings: number | null) => void
  ban: (recipeId: string) => void
  setPinnedType: (pinnedType: string | null) => void
  addDish: (payload: DishPayload) => void
  addRandomDish: () => void
  removeDish: (position: number) => void
  regenerateDish: (position: number) => void
  reorderDish: (from: number, to: number) => void
  editNote: (position: number, text: string) => void
}

export interface SlotContext {
  menuId: string
  day: number
  meal: string
  slot: MealSlot
  /** "jueves 8" — shown in the sheet's eyebrow. */
  dayLabel: string
  isLocked: boolean
  /** Household diner count used when the slot has no override. */
  defaultDiners: number
  isRegenerating?: boolean
}

type OpenSheet = null | "actions" | "picker" | "pin" | "addDish"

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
  const isLeftover = first?.variant === "leftover"
  const canReshape = isSingleRecipe && !isLeftover
  const pinnedType = first?.pinnedType ?? null
  const label = mealLabel(ctx.meal)
  const locked = ctx.isLocked
  const lockedHint = locked ? "Desfíjala para cambiarla" : undefined

  return (
    <>
      <MenuSheet
        open={open === "actions"}
        onClose={close}
        eyebrow={`${label} · ${ctx.dayLabel}`}
        title={first?.recipeName ?? (dishes.length > 0 ? label : "Sin plato todavía")}
      >
        {!isSingleRecipe && dishes.length > 0 && (
          <DishList
            dishes={dishes}
            onOpenRecipe={(id) => router.push(`/recipes/${id}`)}
            handlers={handlers}
          />
        )}

        <div className="flex flex-col gap-0.5">
          {first && (
            <SheetAction icon={BookOpen} label="Ver receta" href={`/recipes/${first.recipeId}`} />
          )}
          {canReshape && (
            <>
              <SheetAction
                icon={Replace}
                label="Elegir otra receta"
                hint={lockedHint ?? "Busca en el catálogo"}
                disabled={locked || ctx.isRegenerating}
                onClick={() => setOpen("picker")}
              />
              <SheetAction
                icon={Shuffle}
                label="Cambiar al azar"
                hint={lockedHint ?? "Otra receta que encaje con tu semana"}
                disabled={locked || ctx.isRegenerating}
                onClick={() => {
                  handlers.regenerate()
                  close()
                }}
              />
            </>
          )}
          <SheetAction
            icon={Plus}
            label="Añadir plato"
            hint={lockedHint ?? "Otro plato o una nota en esta comida"}
            disabled={locked}
            onClick={() => setOpen("addDish")}
          />
          {canReshape && (
            <SheetAction
              icon={Tag}
              label="Tipo de comida"
              hint={
                pinnedType
                  ? `Fijado: ${(MEAL_TYPE_TAG_LABELS as Record<string, string>)[pinnedType] ?? pinnedType}`
                  : lockedHint ?? "Cremas, legumbres, pasta…"
              }
              disabled={locked}
              onClick={() => setOpen("pin")}
            />
          )}
          <SheetAction
            icon={locked ? Unlock : Lock}
            label={locked ? "Desfijar" : "Fijar"}
            hint={locked ? "Volverá a cambiar si regeneras la semana" : "Se queda aunque regeneres la semana"}
            onClick={() => {
              handlers.toggleLock()
              close()
            }}
          />
          {canReshape && first && (
            <SheetAction
              icon={Ban}
              label="Vetar esta receta"
              hint={lockedHint ?? "No volverá a salir esta semana"}
              disabled={locked}
              onClick={() => {
                if (
                  typeof window === "undefined" ||
                  window.confirm(`¿Vetar "${first.recipeName ?? "esta receta"}" del resto de la semana?`)
                ) {
                  handlers.ban(first.recipeId)
                  close()
                }
              }}
            />
          )}
          {first && <CookedAction recipeId={first.recipeId} ctx={ctx} />}
        </div>

        <DinerStepper
          value={ctx.slot.servings ?? null}
          fallback={ctx.defaultDiners}
          disabled={locked}
          onChange={handlers.setServings}
        />

        <div className="mt-1 border-t border-border-soft pt-1">
          <SheetAction
            icon={Trash2}
            label={`Quitar ${label.toLowerCase()}`}
            hint={lockedHint ?? "Solo de este día; tus preferencias no cambian"}
            destructive
            disabled={locked}
            onClick={() => {
              if (
                typeof window === "undefined" ||
                window.confirm(`¿Quitar ${label.toLowerCase()} de este día?`)
              ) {
                handlers.remove()
                close()
              }
            }}
          />
        </div>
      </MenuSheet>

      <PinTypeSheet
        open={open === "pin"}
        onClose={close}
        current={pinnedType}
        onPick={(next) => {
          handlers.setPinnedType(next)
          close()
        }}
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

/* ── "Marcar como cocinada" — records a cook event with the slot as context. */
function CookedAction({ recipeId, ctx }: { recipeId: string; ctx: SlotContext }) {
  const { data } = useRecipeCookStats(recipeId)
  const record = useRecordCook()
  const count = data?.count ?? 0
  return (
    <SheetAction
      icon={ChefHat}
      label={record.isPending ? "Guardando…" : "Marcar como cocinada"}
      hint={count > 0 ? `La has cocinado ${count} ${count === 1 ? "vez" : "veces"}` : undefined}
      disabled={record.isPending}
      onClick={() =>
        record.mutate({ recipeId, menuId: ctx.menuId, dayIndex: ctx.day, meal: ctx.meal })
      }
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
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const from = ids.indexOf(String(e.active.id))
    const to = ids.indexOf(String(e.over.id))
    if (from >= 0 && to >= 0) handlers.reorderDish(from, to)
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
                onClickThumb={dish.kind === "recipe" ? () => onOpenRecipe(dish.recipeId) : undefined}
                onRegenerate={dish.kind === "recipe" ? () => handlers.regenerateDish(i) : undefined}
                onRemove={() => handlers.removeDish(i)}
                onSaveNote={dish.kind === "note" ? (text) => handlers.editNote(i, text) : undefined}
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

/* ── Per-slot diner override. `null` = no override (household default). */
function DinerStepper({
  value,
  fallback,
  disabled,
  onChange,
}: {
  value: number | null
  fallback: number
  disabled: boolean
  onChange: (next: number | null) => void
}) {
  const effective = value ?? fallback
  const hasOverride = value != null
  const clamp = (n: number) => Math.max(1, Math.min(24, n))
  return (
    <div className="mt-1 flex min-h-[56px] items-center justify-between gap-3 rounded-2xl px-3">
      <div className="flex items-center gap-3.5 text-ink">
        <Users size={20} strokeWidth={1.7} />
        <div>
          <p className="text-[15px] font-medium leading-tight">Comensales</p>
          <p className="text-[12.5px] text-ink-soft">
            {hasOverride ? "Solo hoy" : "Los de tu casa"}
            {hasOverride && !disabled && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  className="underline underline-offset-2 hover:text-terracotta-deep"
                >
                  Quitar
                </button>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Menos comensales"
          disabled={disabled || effective <= 1}
          onClick={() => onChange(clamp(effective - 1))}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:bg-cream-deep disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus size={16} />
        </button>
        <span className="min-w-[2rem] text-center text-[16px] font-medium tabular-nums text-ink" aria-live="polite">
          {effective}
        </span>
        <button
          type="button"
          aria-label="Más comensales"
          disabled={disabled || effective >= 24}
          onClick={() => onChange(clamp(effective + 1))}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:bg-cream-deep disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

/* ── Pin a meal type (cremas, pizza…) so Aleatorio/Elegir respect it. */
function PinTypeSheet({
  open,
  onClose,
  current,
  onPick,
}: {
  open: boolean
  onClose: () => void
  current: string | null
  onPick: (next: string | null) => void
}) {
  return (
    <MenuSheet open={open} onClose={onClose} eyebrow="Fijar tipo" title="¿Qué tipo de comida?">
      <div className="flex flex-wrap gap-2">
        {MEAL_TYPE_TAGS.map((tag) => {
          const active = tag === current
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(active ? null : tag)}
              className={`min-h-[44px] rounded-full px-4 text-[14px] transition-colors ${
                active ? "bg-ink text-cream" : "border border-border bg-paper text-ink hover:border-ink"
              }`}
            >
              {MEAL_TYPE_TAG_LABELS[tag]}
            </button>
          )
        })}
      </div>
      {current ? (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="mt-4 min-h-[44px] text-[14px] text-ink-mid underline underline-offset-2 hover:text-ink"
        >
          Quitar pin
        </button>
      ) : (
        <p className="mt-4 text-[13px] text-ink-soft">La sugerencia respetará la etiqueta a partir de ahora.</p>
      )}
    </MenuSheet>
  )
}
