"use client"

/**
 * One dish of a meal with several dishes (PRO-1176): thumbnail, course, name
 * and time; a tap opens the recipe and its «···» opens the dish's own sheet
 * (ver, cambiar, ya está hecho, no repetir, quitar). A note shows its text
 * and its «···» (editar, quitar). The random «Cambiar» it had is gone.
 */
import type { Dish } from "@ona/shared"
import { Coffee, MoreHorizontal, Sparkles } from "lucide-react"

interface Props {
  dish: Dish
  /** Opens the recipe (a recipe dish only). */
  onOpen?: () => void
  /** Opens the dish's sheet. */
  onOptions: () => void
}

const COURSE_LABEL = { starter: "Entrante", main: "Principal", dessert: "Postre" } as const

/** «Entrante», «Principal», «Postre» — a recipe dish without a course says nothing. */
export function courseLabel(dish: Dish): string | null {
  return dish.kind === "recipe" && dish.course ? COURSE_LABEL[dish.course as keyof typeof COURSE_LABEL] ?? null : null
}

/** What the dish is called in its row and in its sheet. */
export function dishName(dish: Dish): string {
  return dish.kind === "note" ? dish.text : dish.recipeName ?? "Receta"
}

export function DishRow({ dish, onOpen, onOptions }: Props) {
  const name = dishName(dish)
  const course = courseLabel(dish)
  const optionsButton = (
    <button
      type="button"
      onClick={onOptions}
      aria-label={`Opciones de ${name}`}
      aria-haspopup="dialog"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <MoreHorizontal size={18} strokeWidth={2} />
    </button>
  )

  if (dish.kind === "note") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-paper py-1 pl-3 pr-1" data-testid="dish-row">
        <Coffee size={16} className="shrink-0 text-ink-muted" />
        <p className="min-w-0 flex-1 truncate text-[14px] italic text-ink-mid">{name}</p>
        {optionsButton}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-paper py-1.5 pl-1.5 pr-1" data-testid="dish-row">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Ver receta: ${name}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-cream-deep">
          {dish.imageUrl ? (
            <img src={dish.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-ink-muted">
              <Sparkles size={18} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          {course && <span className="block text-[10px] uppercase tracking-[0.15em] text-ink-muted">{course}</span>}
          <span className="block truncate text-[14px] font-medium text-ink">{name}</span>
          {dish.totalTime != null && <span className="block text-[12px] text-ink-muted">{dish.totalTime} min</span>}
        </span>
      </button>
      {optionsButton}
    </div>
  )
}
