import type { DayMenu, MealSlot } from '../types/menu.js'
import type { Dish, RecipeDish } from '../types/menuDish.js'
import { isTaperVariant } from '../types/menuDish.js'
import { batchServingsOf, slotServingsOverride } from './leftoverBatch.js'

/**
 * PRO-1046 · el día de lote (batch cooking). Dani y Sara cook on Sunday for
 * Monday to Thursday; the menu showed Sunday as «Día marcado sin cocinar» and
 * the bowl ×8 on Monday as a dish to cook. A recipe dish can say it is cooked
 * in a batch on an earlier day (`RecipeDish.batchDate`, 1 to 6 days before its
 * meal, the week before included): that day shows «Cocinas hoy: bowl ×8 (para
 * lunes a jueves)» and the meal, like its leftovers, is a táper. It stays a
 * planned dish for the shopping list (it is cooked and bought, just earlier).
 */

export const BATCH_MAX_DAYS_BEFORE = 6

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** YYYY-MM-DD plus `n` days (calendar dates, no time zone). */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = lunes … 6 = domingo. */
export function weekdayOfIso(iso: string): number {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7
}

/** «domingo». */
export function weekdayNameOfIso(iso: string): string {
  return WEEKDAYS[weekdayOfIso(iso)]
}

/** Whole days from `a` to `b` (b − a). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

/** A batch day for a meal on `mealDate`: 1 to 6 days before it. */
export function isValidBatchDate(batchDate: string, mealDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(batchDate) || Number.isNaN(Date.parse(`${batchDate}T12:00:00Z`))) return false
  const before = daysBetween(batchDate, mealDate)
  return before >= 1 && before <= BATCH_MAX_DAYS_BEFORE
}

/**
 * The dish is cooked in an earlier batch: a planned recipe (never a leftover
 * copy nor a táper already cooked) with `batchDate`.
 */
export function isBatchCooked(d: Dish | null | undefined): d is RecipeDish & { batchDate: string } {
  return !!d && d.kind === 'recipe' && typeof d.batchDate === 'string' && d.batchDate.length > 0 && d.variant !== 'leftover' && !isTaperVariant(d.variant)
}

/** One dish to cook on a batch day. */
export interface BatchCookItem {
  recipeId: string
  recipeName: string
  imageUrl: string | null
  /** The whole batch: its meal and every leftover of it (`batchServingsOf`). */
  servings: number
  /** Where it is eaten first: the menu week, day and meal (for cook mode). */
  weekStart: string
  day: number
  meal: string
  position: number
  /** Every date it feeds, in order: its meal and its leftovers. */
  forDates: string[]
}

type Week = { weekStart: string; days: ReadonlyArray<DayMenu | null | undefined> } | null | undefined

const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner']
const mealRank = (m: string) => {
  const i = MEAL_ORDER.indexOf(m)
  return i < 0 ? MEAL_ORDER.length : i
}

/**
 * What is cooked in the batch of `date`: every dish of `weeks` (the week of
 * that day and the next one, a Sunday batch feeds the next week) whose
 * `batchDate` is that date, with its rations and the days it feeds. Pure.
 */
export function batchCookingOn(date: string, weeks: ReadonlyArray<Week>, household: number): BatchCookItem[] {
  const out: BatchCookItem[] = []
  const seen = new Set<string>()
  for (const week of weeks) {
    if (!week || seen.has(week.weekStart)) continue
    seen.add(week.weekStart)
    const days = week.days ?? []
    days.forEach((dayMenu, day) => {
      const meals = Object.keys(dayMenu ?? {}).sort((a, b) => mealRank(a) - mealRank(b))
      for (const meal of meals) {
        const slot = (dayMenu as DayMenu)[meal] as MealSlot | undefined
        const dishes = slot?.dishes ?? []
        dishes.forEach((dish, position) => {
          if (!isBatchCooked(dish) || dish.batchDate !== date) return
          const firstRecipe = dishes.findIndex((d) => d.kind === 'recipe')
          const servings = position === firstRecipe ? batchServingsOf(days, day, meal, household) : (slotServingsOverride(slot) ?? household)
          const leftoverDates: string[] = []
          days.forEach((d2, i) => {
            for (const s of Object.values(d2 ?? {}) as (MealSlot | undefined)[]) {
              const hit = (s?.dishes ?? []).some(
                (x) =>
                  x.kind === 'recipe' &&
                  x.variant === 'leftover' &&
                  x.recipeId === dish.recipeId &&
                  x.leftoverOf?.day === day &&
                  x.leftoverOf?.meal === meal &&
                  (x.leftoverOf?.dishPosition ?? 0) === position,
              )
              if (hit) leftoverDates.push(addDaysIso(week.weekStart, i))
            }
          })
          const forDates = [...new Set([addDaysIso(week.weekStart, day), ...leftoverDates])].sort()
          out.push({
            recipeId: dish.recipeId,
            recipeName: dish.recipeName ?? 'Receta',
            imageUrl: dish.imageUrl ?? null,
            servings,
            weekStart: week.weekStart,
            day,
            meal,
            position,
            forDates,
          })
        })
      }
    })
  }
  return out.sort((a, b) => (a.forDates[0] ?? '').localeCompare(b.forDates[0] ?? '') || mealRank(a.meal) - mealRank(b.meal))
}

/**
 * «para lunes a jueves» (consecutive days), «para el viernes», «para el
 * lunes y el miércoles», «para el lunes, el miércoles y el viernes». Pure.
 */
export function batchForLabel(dates: ReadonlyArray<string>): string {
  const sorted = [...new Set(dates)].sort()
  if (sorted.length === 0) return ''
  if (sorted.length === 1) return `para el ${weekdayNameOfIso(sorted[0])}`
  const consecutive = sorted.every((d, i) => i === 0 || daysBetween(sorted[i - 1], d) === 1)
  if (consecutive && sorted.length > 2) return `para ${weekdayNameOfIso(sorted[0])} a ${weekdayNameOfIso(sorted[sorted.length - 1])}`
  const names = sorted.map((d) => `el ${weekdayNameOfIso(d)}`)
  return `para ${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/** «Bowl de pollo ×8 (para lunes a jueves)». Pure. */
export function batchCookLine(item: Pick<BatchCookItem, 'recipeName' | 'servings' | 'forDates'>): string {
  return `${item.recipeName} ×${item.servings} (${batchForLabel(item.forDates)})`
}
