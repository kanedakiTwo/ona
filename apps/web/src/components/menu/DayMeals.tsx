"use client"

/**
 * One day of the menu, "D · Luz y foto" (2026-10-08):
 *   - the featured meal (first one with a recipe) as a photo hero with an
 *     overlapping caption card: eyebrow "Comida · 28 min · 3 raciones",
 *     Fraunces title, ink pill "Empezar a cocinar" (→ cook mode, with its menu slot) and "···";
 *     today, a quiet «¿Otra cosa? Cocinar ahora» (→ /cocinar) under them;
 *   - the other meals as horizontal rows (photo, eyebrow, title) + "···";
 *   - empty slots as one quiet "Añadir plato" card + "···"; tapping the card
 *     opens the same sheet as "···" (Miguel, 2026-11-05);
 *   - a meal the rest of the week has and this day lacks as «El viernes no
 *     hay comida» + «Añadir» (`absentMeals`), so a dinner can't pass for lunch;
 *     tapping it opens what to put there (elegir, al azar, táper), never a
 *     dish nobody asked for (Miguel, 2026-11-05);
 *   - a quiet day footer: "Añadir comida" (missing slots) and "Saltar día".
 * Used full-bleed on mobile and inside the desktop hero row.
 */
import { useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { motion, useReducedMotion } from "motion/react"
import { BookOpen, CalendarX, Check, History, Lock, Play, Plus, Refrigerator, Replace, RotateCw, Shuffle, Snowflake, TriangleAlert, Utensils, X } from "lucide-react"
import { FreezerDishSheets, type TaperVariant } from "./FreezerDishSheets"
import { isTaperDish, replacedDishLine, weekTypeChipOf, type MealSlot, type RecipeDish } from "@ona/shared"
import { DishTypeIcon } from "@/components/weekType/DishTypeIcon"
import { cookHref } from "@/lib/cookHref"
import { mealLabel } from "@/lib/labels"
import { trackSheetAction } from "@/lib/usageEvents"
import { DAY_MEAL_ORDER, dishName, firstRecipeDish, mealEyebrow, slotDishParts, slotMinutes, type DaySlot, type MealKey } from "@/lib/menuDay"
import { RecipeCover, mealIconFor } from "./RecipeCover"
import { ConfirmSheet, MenuSheet, SheetAction } from "./MenuSheet"
import { RecipePickerSheet } from "./RecipePickerSheet"
import {
  MealOptionsButton,
  MealOptionsSheets,
  slotRecipeHref,
  slotServings,
  useMealOptions,
  type SlotContext,
  type SlotHandlers,
} from "./MealOptions"

const DAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]

export type SlotPropsFn = (meal: string, slot: MealSlot) => { ctx: SlotContext; handlers: SlotHandlers }

const servingsOf = slotServings

/** Small state chips under a title — only rendered when there is state to show. */
function SlotChips({
  ctx,
  first,
  showEatenElsewhere = false,
}: {
  ctx: SlotContext
  first: RecipeDish | null
  /** The hero shows «✓ Comido» in its action row instead of a chip. */
  showEatenElsewhere?: boolean
}) {
  const leftover = first?.variant === "leftover" && first.leftoverOf
  const fromFreezer = first?.variant === "freezer"
  const fromFridge = first?.variant === "fridge"
  const fromOtherDay = first?.variant === "cooked"
  const eaten = !!ctx.slot.eaten && !showEatenElsewhere
  // PRO-364: someone saved an allergy or diet this dish breaks and there was nothing to put instead.
  const conflict = (ctx.slot.dishes ?? []).some((d) => d.kind === "recipe" && d.restrictionConflict)
  // PRO-345: Mimoia changed the dish because the recipe changed or was deleted.
  const replaced = first?.replaced ?? null
  // PRO-1186: «Legumbres · semana tipo», or the warning when no recipe of that type fitted.
  const weekType = weekTypeChipOf(ctx.slot.dishes)
  if (!conflict && !ctx.isLocked && !leftover && !fromFreezer && !fromFridge && !fromOtherDay && !eaten && !replaced && !weekType && ctx.slot.servings == null) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-mid">
      {conflict && (
        <span data-testid="restriction-conflict" className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-2 py-0.5 font-semibold text-terracotta-deep">
          <TriangleAlert size={11} strokeWidth={2.4} /> No encaja con las alergias o la dieta de casa · cámbialo en «···»
        </span>
      )}
      {replaced && (
        <span data-testid="dish-replaced" className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-2 py-0.5 font-medium text-terracotta-deep">
          <RotateCw size={11} /> {replacedDishLine(replaced)}
        </span>
      )}
      {weekType && (
        <span
          data-testid={weekType.missing ? "week-type-missing" : "week-type-chip"}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${weekType.missing ? "bg-warn-bg text-terracotta-deep" : "bg-cream-deep text-ink-mid"}`}
        >
          {weekType.missing ? <TriangleAlert size={11} strokeWidth={2.2} /> : <DishTypeIcon type={weekType.type ?? "recipe"} size={12} />} {weekType.label}
        </span>
      )}
      {eaten && (
        <span data-testid="meal-eaten" className="inline-flex items-center gap-1 rounded-full bg-forest/10 px-2 py-0.5 font-semibold text-forest">
          <Check size={11} strokeWidth={2.6} /> Comido
        </span>
      )}
      {/* PRO-1175: a quiet lock, not «Fijada» — every dish chosen by hand has it now. */}
      {ctx.isLocked && (
        <span data-testid="meal-kept" title="Se queda si rehaces la semana" className="inline-flex items-center rounded-full bg-cream-deep px-1.5 py-1 text-ink-mid">
          <Lock size={11} strokeWidth={2.2} role="img" aria-label="Se queda si rehaces la semana" />
        </span>
      )}
      {fromFreezer && (
        <span className="inline-flex items-center gap-1 rounded-full bg-cream-deep px-2 py-0.5 font-medium text-ink">
          <Snowflake size={11} /> Del congelador · no suma a la compra
        </span>
      )}
      {fromFridge && (
        <span data-testid="taper-fridge" className="inline-flex items-center gap-1 rounded-full bg-cream-deep px-2 py-0.5 font-medium text-ink">
          <Refrigerator size={11} /> Táper de la nevera · no suma a la compra
        </span>
      )}
      {fromOtherDay && (
        <span data-testid="taper-other-day" className="inline-flex items-center gap-1 rounded-full bg-cream-deep px-2 py-0.5 font-medium text-ink">
          <History size={11} /> Sobras de otro día · no suma a la compra
        </span>
      )}
      {leftover && first?.leftoverOf && (
        <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-2 py-0.5 font-medium text-terracotta-deep">
          <Utensils size={11} /> Sobras de {DAY_SHORT[first.leftoverOf.day]} {mealLabel(first.leftoverOf.meal).toLowerCase()} · ya en la compra
        </span>
      )}
      {ctx.slot.servings != null && !leftover && (
        <span className="rounded-full bg-cream-deep px-2 py-0.5">Solo hoy: {ctx.slot.servings}</span>
      )}
    </div>
  )
}

/* ─────────────────────────── Other dishes ─────────────────────────── */

/**
 * The meal's other dishes (Miguel, 2026-11-10: «había una nota de Romanescu
 * que no se veía por ningún sitio»): one line each with its name — a recipe
 * links to it, a written dish in italics — and «Quitar» (×), under the main
 * dish. Until then they were a small «+ Romanescu» next to the chips.
 */
export function ExtraDishLines({
  ctx,
  handlers,
  readOnly,
  size = "md",
  className = "",
}: {
  ctx: SlotContext
  handlers: SlotHandlers
  readOnly: boolean
  /** `lg` = the desktop hero, `md` = mobile hero and rows, `sm` = small side rows. */
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const { others } = slotDishParts(ctx.slot)
  if (others.length === 0) return null
  const text = size === "lg" ? "text-[18px]" : size === "md" ? "text-[16px]" : "text-[15px]"
  const canRemove = !readOnly
  return (
    <ul data-testid="extra-dishes" className={`flex flex-col ${className}`}>
      {others.map(({ dish, position }) => {
        const name = dishName(dish)
        return (
          <li
            key={`${position}-${name}`}
            data-extra-dish={name}
            className="flex min-h-[36px] items-center gap-2.5 border-t border-dashed border-border-soft first:border-t-0"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-terracotta" />
            {dish.kind === "recipe" ? (
              <Link
                href={slotRecipeHref(dish.recipeId, ctx)}
                className={`min-w-0 flex-1 font-serif-text font-[600] leading-[1.2] text-ink hover:underline hover:underline-offset-4 ${text}`}
              >
                {name}
              </Link>
            ) : (
              <span className={`min-w-0 flex-1 font-serif-text italic leading-[1.2] text-ink-mid ${text}`}>{name}</span>
            )}
            {canRemove && (
              <button
                type="button"
                onClick={() => {
                  trackSheetAction("plato", "quitar_plato")
                  handlers.removeDish(position)
                }}
                aria-label={`Quitar «${name}»`}
                className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-cream-deep hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
              >
                <X size={15} />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ─────────────────────────────── Hero ─────────────────────────────── */

export function MealHero({
  ctx,
  handlers,
  readOnly,
  layout = "bleed",
  isToday = false,
}: {
  ctx: SlotContext
  handlers: SlotHandlers
  readOnly: boolean
  /** The day shown is today: a quiet «¿Otra cosa? Cocinar ahora» under the actions (specs/cook-now.md). */
  isToday?: boolean
  /** `bleed` = mobile, photo edge to edge + caption card overlapping below.
   *  `card` = desktop, rounded 420 px photo with the caption card inside. */
  layout?: "bleed" | "card"
}) {
  const ctl = useMealOptions()
  const reduce = useReducedMotion()
  const first = firstRecipeDish(ctx.slot)!
  const name = first.recipeName ?? "Receta"
  const eyebrow = mealEyebrow(mealLabel(ctx.meal), slotMinutes(ctx.slot), servingsOf(ctx))
  // Remember which URL failed, so swapping to another recipe tries its photo.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const hasPhoto = Boolean(first.imageUrl) && failedSrc !== first.imageUrl

  const captionText = (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted lg:text-[12px]">{eyebrow}</p>
      <h2 className="font-serif-text text-[25px] font-[650] leading-[1.12] text-ink lg:text-[32px] lg:leading-[1.1]">
        <Link href={slotRecipeHref(first.recipeId, ctx)} className="hover:underline hover:decoration-1 hover:underline-offset-4">
          {name}
        </Link>
      </h2>
      <SlotChips ctx={ctx} first={first} showEatenElsewhere />
      <ExtraDishLines ctx={ctx} handlers={handlers} readOnly={readOnly} size={layout === "card" ? "lg" : "md"} className="mt-1" />
    </div>
  )
  const captionActions = (
    <div className="flex gap-2">
      {isTaperDish(first) && !ctx.slot.eaten ? (
        // A táper (freezer or fridge, PRO-240) is already cooked: no «Empezar a cocinar».
        <Link
          href={slotRecipeHref(first.recipeId, ctx)}
          data-testid="taper-see-recipe"
          className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-full border border-border bg-paper px-[22px] text-[15px] font-medium text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:flex-none"
        >
          <BookOpen size={15} />
          Ver receta
        </Link>
      ) : ctx.slot.eaten ? (
        // Eaten (Mimo or «Marcar como cocinada», PRO-185): no «Empezar a cocinar».
        <>
          <span
            data-testid="meal-eaten"
            className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-full bg-forest/10 px-[22px] text-[15px] font-semibold text-forest lg:flex-none"
          >
            <Check size={16} strokeWidth={2.6} />
            Comido
          </span>
          <Link
            href={slotRecipeHref(first.recipeId, ctx)}
            className="flex h-[46px] items-center justify-center gap-2 rounded-full border border-border bg-paper px-[18px] text-[15px] font-medium text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <BookOpen size={15} />
            Ver receta
          </Link>
        </>
      ) : (
      <Link
        href={cookHref(first.recipeId, servingsOf(ctx), { menuId: ctx.menuId, day: ctx.day, meal: ctx.meal })}
        className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-full bg-ink px-[22px] text-[15px] font-semibold text-cream transition-colors hover:bg-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:flex-none"
      >
        <Play size={15} fill="currentColor" strokeWidth={0} />
        Empezar a cocinar
      </Link>
      )}
      {!readOnly && (
        <MealOptionsButton
          ctl={ctl}
          label={`Más opciones de ${mealLabel(ctx.meal).toLowerCase()}: cambiar plato, vetar, comensales`}
          className="h-[46px] w-[46px] border border-border bg-paper"
        />
      )}
    </div>
  )
  const cookNowLink = isToday && !readOnly && (
    <Link
      href="/cocinar"
      data-testid="menu-cook-now"
      className="self-start text-[13px] text-ink-soft underline decoration-1 underline-offset-4 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      ¿Otra cosa? Cocinar ahora
    </Link>
  )

  const motionProps = {
    "data-testid": "menu-hero",
    "data-photo": hasPhoto ? "1" : "0",
    initial: reduce ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, ease: [0.19, 1, 0.22, 1] as const },
  }
  const sheets = !readOnly && <MealOptionsSheets ctl={ctl} ctx={ctx} handlers={handlers} />

  // No photo (or it failed to load): no tall empty block and no second copy
  // of the name — the caption becomes a normal card at the top, with the
  // meal's small icon on a bone square.
  if (!hasPhoto) {
    const Icon = mealIconFor(ctx.meal)
    return (
      <motion.article
        {...motionProps}
        className={
          layout === "card"
            ? "flex flex-col gap-4 rounded-[24px] border border-border-soft bg-paper p-6"
            : "mx-4 mt-4 flex flex-col gap-3 rounded-[22px] border border-border-soft bg-paper p-4"
        }
      >
        <div className="flex items-start gap-3.5 lg:gap-5">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-bone text-clay lg:h-[72px] lg:w-[72px]"
          >
            <Icon size={24} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">{captionText}</div>
        </div>
        {captionActions}
        {cookNowLink}
        {sheets}
      </motion.article>
    )
  }

  return (
    <motion.article
      {...motionProps}
      className={layout === "card" ? "relative h-[420px] overflow-hidden rounded-[24px]" : "relative mt-3"}
    >
      <Link
        href={slotRecipeHref(first.recipeId, ctx)}
        tabIndex={-1}
        aria-hidden="true"
        className={layout === "card" ? "block h-full" : "block"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={first.imageUrl!}
          alt={name}
          loading="eager"
          onError={() => setFailedSrc(first.imageUrl ?? null)}
          className={layout === "card" ? "h-full w-full object-cover" : "h-[300px] w-full object-cover"}
        />
      </Link>
      <div
        className={
          layout === "card"
            ? "absolute bottom-6 left-6 flex max-w-[440px] flex-col gap-3 rounded-[20px] bg-paper px-5 py-[18px]"
            : "relative mx-4 -mt-[60px] flex flex-col gap-2.5 rounded-[22px] border border-border-soft bg-paper py-[14px] pl-4 pr-[14px]"
        }
      >
        {captionText}
        {captionActions}
        {cookNowLink}
      </div>
      {sheets}
    </motion.article>
  )
}

/* ─────────────────────────────── Row ─────────────────────────────── */

export function MealRow({
  ctx,
  handlers,
  readOnly,
}: {
  ctx: SlotContext
  handlers: SlotHandlers
  readOnly: boolean
}) {
  const ctl = useMealOptions()
  const first = firstRecipeDish(ctx.slot)
  const label = mealLabel(ctx.meal)
  const dishes = ctx.slot.dishes ?? []

  if (dishes.length === 0) {
    return <EmptyMealCard ctx={ctx} handlers={handlers} readOnly={readOnly} />
  }

  // The main dish big; the others as lines under it (a note-only slot,
  // «Cenamos fuera», shows its first text as the title, PRO-185).
  const { main } = slotDishParts(ctx.slot)
  const title = main ? dishName(main) : ""
  const eyebrow = mealEyebrow(label, slotMinutes(ctx.slot))
  const body = (
    <>
      <RecipeCover
        src={first?.imageUrl}
        name={title}
        meal={ctx.meal}
        className="h-[88px] w-[104px] shrink-0 rounded-2xl"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          {ctx.isLocked && <Lock size={11} strokeWidth={2.2} role="img" aria-label="Se queda si rehaces la semana" />}
          {eyebrow}
        </span>
        <span className={`font-serif-text text-[20px] font-[650] leading-[1.15] text-ink ${first ? "" : "italic"}`}>{title}</span>
        <SlotChips ctx={{ ...ctx, isLocked: false }} first={first} />
      </span>
    </>
  )

  return (
    <div className="mx-4 flex flex-col">
      <div className="flex items-center gap-1">
        {first ? (
          <Link
            href={slotRecipeHref(first.recipeId, ctx)}
            className="flex min-w-0 flex-1 items-center gap-3.5 rounded-2xl text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {body}
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3.5">{body}</div>
        )}
        {!readOnly && (
          <>
            <MealOptionsButton ctl={ctl} label={`Más opciones de ${label.toLowerCase()}`} className="text-ink-mid" />
            <MealOptionsSheets ctl={ctl} ctx={ctx} handlers={handlers} />
          </>
        )}
      </div>
      <ExtraDishLines ctx={ctx} handlers={handlers} readOnly={readOnly} className="ml-[118px] mt-1.5 pr-1" />
    </div>
  )
}

/* ─────────────────────────── Empty slot ─────────────────────────── */

export function EmptyMealCard({
  ctx,
  handlers,
  readOnly,
  compact = false,
}: {
  ctx: SlotContext
  handlers: SlotHandlers
  readOnly: boolean
  compact?: boolean
}) {
  const ctl = useMealOptions()
  const label = mealLabel(ctx.meal)
  return (
    <div
      className={`flex items-center gap-1 rounded-2xl border border-dashed border-border bg-paper/60 p-1.5 ${compact ? "" : "mx-4"}`}
    >
      {readOnly ? (
        <p className="flex-1 px-3 py-3 text-[14px] text-ink-soft">
          <span className="font-semibold uppercase tracking-[0.14em] text-[11px] text-ink-muted">{label}</span> · sin plato
        </p>
      ) : (
        <>
          {/* The same sheet as "···": Añadir plato, Fijar, Comensales, Quitar (Miguel, 2026-11-05). */}
          <button
            type="button"
            onClick={() => ctl.setOpen("actions")}
            aria-haspopup="dialog"
            data-testid="empty-meal"
            className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 text-left transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-ink"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bone text-clay">
              <Plus size={18} strokeWidth={1.8} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{label}</span>
              <span className="text-[15px] font-medium text-ink">Añadir plato</span>
            </span>
          </button>
          <MealOptionsButton ctl={ctl} label={`Más opciones de ${label.toLowerCase()}`} className="text-ink-mid" />
          <MealOptionsSheets ctl={ctl} ctx={ctx} handlers={handlers} />
        </>
      )}
    </div>
  )
}

/* ─────────────────────────── Absent meal ─────────────────────────── */

/** The day's meals the rest of the week has and it lacks (`absentMeals`). */
export interface AbsentMeals {
  meals: MealKey[]
  dayName: string
  isAdding: boolean
  /** Creates the meal: with `recipeId`, that recipe; without, one the matcher picks. */
  onAdd: (meal: MealKey, recipeId?: string) => void
  /** «Usar "<lo escrito>" como plato» in the picker: the meal as a note. */
  onAddNote?: (meal: MealKey, text: string) => void
  /** «Del congelador» (PRO-82) / «Táper de la nevera» (PRO-240). */
  onAddFreezer?: (meal: MealKey, recipeId: string, variant: TaperVariant) => void
}

/**
 * «El viernes no hay comida» + «Añadir» (Miguel, 2026-10-19: the day's
 * dinner passed for its lunch). Tapping it opens what to put there —
 * «Elegir receta», «Una al azar», a táper — instead of adding a dish
 * nobody chose (Miguel, 2026-11-05: «que me aparezca el menú contextual»).
 */
export function AbsentMealCard({
  meal,
  dayName,
  isAdding,
  onAdd,
  onAddNote,
  onAddFreezer,
  readOnly,
  compact = false,
}: Omit<AbsentMeals, "meals"> & { meal: MealKey; readOnly: boolean; compact?: boolean }) {
  const label = mealLabel(meal)
  const Icon = mealIconFor(meal)
  const [open, setOpen] = useState<AbsentSheet>(null)
  const body = (
    <>
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bone text-clay">
        <Icon size={18} strokeWidth={1.6} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col py-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{label}</span>
        <span className="text-[15px] italic text-ink-mid">
          El {dayName} no hay {label.toLowerCase()}
        </span>
      </span>
    </>
  )
  return (
    <div
      data-testid="absent-meal"
      data-meal={meal}
      className={`rounded-2xl border border-dashed border-border ${compact ? "" : "mx-4"}`}
    >
      {readOnly ? (
        <div className="flex items-center gap-3 p-1.5 pl-2.5">{body}</div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen("actions")}
          disabled={isAdding}
          aria-haspopup="dialog"
          aria-label={`Añadir ${label.toLowerCase()} al ${dayName}`}
          className="flex w-full items-center gap-3 rounded-2xl p-1.5 pl-2.5 text-left transition-colors hover:bg-cream-deep disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ink"
        >
          {body}
          <span className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border border-border bg-paper px-3.5 text-[14px] font-medium text-ink">
            <Plus size={14} /> Añadir
          </span>
        </button>
      )}
      {!readOnly && (
        <AbsentMealSheets
          open={open}
          setOpen={setOpen}
          meal={meal}
          dayName={dayName}
          isAdding={isAdding}
          onAdd={onAdd}
          onAddNote={onAddNote}
          onAddFreezer={onAddFreezer}
        />
      )}
    </div>
  )
}

export type AbsentSheet = null | "actions" | "picker" | TaperVariant

/**
 * What to put in a meal the day lacks: «Comida · viernes — Sin plato
 * todavía» with Elegir receta, Una al azar, Del congelador and Táper de la
 * nevera, then the picker or the táper sheets. Shared by the «El viernes no
 * hay comida» card and the «no hay» cells of «La semana» (2026-11-10).
 */
export function AbsentMealSheets({
  open,
  setOpen,
  meal,
  dayName,
  isAdding,
  onAdd,
  onAddNote,
  onAddFreezer,
}: Omit<AbsentMeals, "meals"> & { meal: MealKey; open: AbsentSheet; setOpen: (next: AbsentSheet) => void }) {
  const label = mealLabel(meal)
  const close = () => setOpen(null)
  return (
    <>
      <MenuSheet open={open === "actions"} onClose={close} eyebrow={`${label} · ${dayName}`} title="Sin plato todavía" sheet="no_hay">
        <div className="flex flex-col gap-0.5">
          <SheetAction icon={Replace} label="Elegir receta" action="elegir_receta" hint="Busca en el catálogo" onClick={() => setOpen("picker")} />
          <SheetAction
            icon={Shuffle}
            label="Una al azar"
            action="cambiar_azar"
            hint="Una receta que encaje con tu semana"
            disabled={isAdding}
            onClick={() => {
              onAdd(meal)
              close()
            }}
          />
          {onAddFreezer && (
            <div className="mt-1 border-t border-border-soft pt-1">
              <SheetAction
                icon={Snowflake}
                label="Del congelador"
                action="congelador"
                hint="Un táper que ya tienes: no suma a la compra"
                onClick={() => setOpen("freezer")}
              />
              <SheetAction
                icon={Refrigerator}
                label="Táper de la nevera"
                action="taper_nevera"
                hint="Ya cocinado, en la nevera: no suma a la compra"
                onClick={() => setOpen("fridge")}
              />
            </div>
          )}
        </div>
      </MenuSheet>
      {/* Out of the page's transformed wrappers, like the meal sheet's picker. */}
      {typeof document !== "undefined" &&
        createPortal(
          <RecipePickerSheet
            open={open === "picker"}
            onClose={close}
            title={`${label} del ${dayName}`}
            subtitle="Sin plato"
            onPick={(picked) => {
              onAdd(meal, picked.id)
              close()
            }}
            onUseText={
              onAddNote
                ? (text) => {
                    onAddNote(meal, text)
                    close()
                  }
                : undefined
            }
          />,
          document.body,
        )}
      {onAddFreezer && (
        <FreezerDishSheets
          open={open === "freezer" || open === "fridge"}
          onClose={close}
          missing={[meal]}
          variant={open === "fridge" ? "fridge" : "freezer"}
          onAdd={(m, recipeId) => onAddFreezer(m, recipeId, open === "fridge" ? "fridge" : "freezer")}
        />
      )}
    </>
  )
}

/* ───────────────────────── Skipped day ───────────────────────── */

export function SkippedDay({ readOnly, onUnskip }: { readOnly: boolean; onUnskip: () => void }) {
  return (
    <div className="mx-4 mt-4 rounded-[22px] border border-dashed border-border bg-paper px-6 py-10 text-center">
      <CalendarX size={22} className="mx-auto text-ink-soft" />
      <p className="mt-3 font-serif-text text-[20px] italic text-ink-mid">Día marcado sin cocinar.</p>
      {!readOnly && (
        <button
          type="button"
          onClick={() => {
            trackSheetAction("dia", "reactivar_dia")
            onUnskip()
          }}
          className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:border-ink"
        >
          <RotateCw size={14} /> Reactivar día
        </button>
      )}
    </div>
  )
}

/* ───────────────────────── Day footer ───────────────────────── */

export function DayFooter({
  dayName,
  missing,
  canSkip,
  isAdding,
  onAddMeal,
  onSkip,
  onAddFreezer,
}: {
  dayName: string
  missing: MealKey[]
  canSkip: boolean
  isAdding: boolean
  onAddMeal: (meal: MealKey) => void
  onSkip: () => void
  /** «Del congelador» (PRO-82) / «Táper de la nevera» (PRO-240): a táper that never adds to the shopping list. */
  onAddFreezer?: (meal: MealKey, recipeId: string, variant: TaperVariant) => void
}) {
  const [taperOpen, setTaperOpen] = useState<TaperVariant | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmSkip, setConfirmSkip] = useState(false)
  if (missing.length === 0 && !canSkip) return null
  return (
    <div className="mx-4 flex flex-wrap items-center gap-2">
      {missing.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:border-ink"
        >
          <Plus size={15} /> Añadir comida
        </button>
      )}
      {canSkip && (
        <button
          type="button"
          onClick={() => {
            trackSheetAction("dia", "saltar_dia")
            setConfirmSkip(true)
          }}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-[14px] text-ink-mid transition-colors hover:bg-cream-deep hover:text-ink"
        >
          <CalendarX size={15} /> Saltar día
        </button>
      )}
      <ConfirmSheet
        open={confirmSkip}
        onClose={() => setConfirmSkip(false)}
        onConfirm={onSkip}
        eyebrow="Solo afecta a esta semana"
        title={`¿Marcar ${dayName} como sin cocinar?`}
        message="Se quitan sus platos, salvo los fijados. Con «Reactivar día» puedes volver a llenarlo."
        confirmLabel="Saltar día"
      />
      <MenuSheet open={open} onClose={() => setOpen(false)} eyebrow="Solo afecta a esta semana" title={`Añadir comida al ${dayName}`} sheet="dia">
        <div className="flex flex-col gap-0.5">
          {missing.map((m) => (
            <SheetAction
              key={m}
              icon={Plus}
              label={mealLabel(m)}
              action="anadir_comida"
              disabled={isAdding}
              onClick={() => {
                onAddMeal(m)
                setOpen(false)
              }}
            />
          ))}
          {onAddFreezer && (
            <div className="mt-1 border-t border-border-soft pt-1">
              <SheetAction
                icon={Snowflake}
                label="Del congelador"
                action="congelador"
                hint="Un táper que ya tienes: no suma a la compra"
                disabled={isAdding}
                onClick={() => {
                  setOpen(false)
                  setTaperOpen("freezer")
                }}
              />
              <SheetAction
                icon={Refrigerator}
                label="Táper de la nevera"
                action="taper_nevera"
                hint="Ya cocinado, en la nevera: no suma a la compra"
                disabled={isAdding}
                onClick={() => {
                  setOpen(false)
                  setTaperOpen("fridge")
                }}
              />
            </div>
          )}
        </div>
      </MenuSheet>
      {onAddFreezer && (
        <FreezerDishSheets
          open={taperOpen != null}
          onClose={() => setTaperOpen(null)}
          missing={missing}
          variant={taperOpen ?? "freezer"}
          onAdd={(meal, recipeId) => onAddFreezer(meal, recipeId, taperOpen ?? "freezer")}
        />
      )}
    </div>
  )
}

/* ─────────────────────────── Whole day ─────────────────────────── */

export function DayMeals({
  featured,
  rest,
  absent,
  slotProps,
  readOnly,
  isToday = false,
}: {
  featured: DaySlot | null
  rest: DaySlot[]
  absent?: AbsentMeals
  slotProps: SlotPropsFn
  readOnly: boolean
  /** The day shown is today (the menu page knows it from its day strip). */
  isToday?: boolean
}) {
  return (
    <>
      {featured && (
        // data-first-steps: the dish the «Primeros pasos» guide lights up (PRO-07).
        <div data-first-steps="dish">
          <MealHero {...slotProps(featured.meal, featured.slot)} readOnly={readOnly} isToday={isToday} />
        </div>
      )}
      <div className={`flex flex-col gap-3.5 ${featured ? "mt-3.5" : "mt-4"}`}>
        {DAY_MEAL_ORDER.map((m) => {
          const s = rest.find((r) => r.meal === m)
          if (s) return <MealRow key={m} {...slotProps(m, s.slot)} readOnly={readOnly} />
          if (absent?.meals.includes(m))
            return (
              <AbsentMealCard
                key={m}
                meal={m}
                dayName={absent.dayName}
                isAdding={absent.isAdding}
                onAdd={absent.onAdd}
                onAddNote={absent.onAddNote}
                onAddFreezer={absent.onAddFreezer}
                readOnly={readOnly}
              />
            )
          return null
        })}
      </div>
    </>
  )
}
