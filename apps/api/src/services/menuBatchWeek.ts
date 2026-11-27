/**
 * PRO-1262 · La semana en lote. A household that cooks in batches («Batch
 * cooking» in «¿Cómo cocináis en casa?», or the ficha's `batch_cooking`;
 * `batchCookingOf` in `profile/reader.ts`) got from the generator a
 * different dish in every meal, each «Solo hoy: 2» and no leftovers (Dani y
 * Sara, the week Mimo made on Thursday 12-nov). Now the drawn week comes out
 * as a batch: Monday to Thursday, the lunch and the dinner of Monday and of
 * Wednesday are cooked on the batch day (the Sunday before, or the Saturday;
 * `batchDate`, the día de lote of PRO-1046) and the next day eats their
 * leftovers (`variant: 'leftover'`, «Sobras de lun comida»). Friday and the
 * weekend stay as drawn.
 *
 * Only the draw's slots: never a locked one, a «sin cocinar» day, the week
 * type's preset or táper slots (`keep`), nor a slot with a note. A leftover
 * day whose dishes the week type asked for (a type) stays as drawn. A dish
 * that wouldn't keep until its last day (`fridgeDays`) is swapped for one
 * that does (`replace`); with none, that pair is cooked each day as drawn.
 * Pure: returns copies.
 */
import { addDaysIso, isTaperVariant, type DayMenu, type LockedSlots, type MealSlot, type RecipeDish } from '@ona/shared'

/** Monday + Tuesday and Wednesday + Thursday: the first day cooked in the batch, the second its leftovers. */
export const BATCH_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [2, 3],
]
export const BATCH_MEALS = ['lunch', 'dinner'] as const

export interface BatchWeekOptions {
  weekStart: string
  /** Days before Monday the batch is cooked: 1 = Sunday (default), 2 = Saturday. */
  daysBefore?: number
  locked?: LockedSlots
  skippedDays?: ReadonlySet<number>
  /** Slots that aren't the draw's (the week type's preset or táper slots): never touched. */
  keep?: (dayIndex: number, meal: string) => boolean
  /** The recipe keeps `days` days in the fridge after it is cooked. Absent = every recipe keeps. */
  keeps?: (recipeId: string, days: number) => boolean
  /** Another recipe for that dish of the slot that keeps `days` days, or null. */
  replace?: (dayIndex: number, meal: string, dish: RecipeDish, days: number, used: ReadonlySet<string>) => RecipeDish | null
}

const isDrawnRecipe = (d: unknown): d is RecipeDish => {
  const dish = d as RecipeDish
  return !!dish && dish.kind === 'recipe' && !dish.leftoverOf && dish.variant !== 'leftover' && !isTaperVariant(dish.variant) && !dish.fixedDish
}

function usedIn(days: readonly DayMenu[]): Set<string> {
  const used = new Set<string>()
  for (const day of days) for (const slot of Object.values(day ?? {})) for (const d of slot?.dishes ?? []) if (d.kind === 'recipe') used.add(d.recipeId)
  return used
}

/** A slot of the draw the batch may take: there, not locked, not «sin cocinar», not the week type's, only drawn recipes. */
function free(days: readonly DayMenu[], dayIndex: number, meal: string, o: BatchWeekOptions): MealSlot | null {
  const slot = days[dayIndex]?.[meal]
  if (!slot?.dishes?.length) return null
  if (o.skippedDays?.has(dayIndex) || o.locked?.[String(dayIndex)]?.[meal] || o.keep?.(dayIndex, meal)) return null
  if (slot.taper || !slot.dishes.every(isDrawnRecipe)) return null
  return slot
}

export function applyBatchWeek(days: DayMenu[], o: BatchWeekOptions): DayMenu[] {
  const daysBefore = o.daysBefore ?? 1
  const batchDate = addDaysIso(o.weekStart.slice(0, 10), -daysBefore)
  const out = days.map((d) => ({ ...(d ?? {}) }))
  const used = usedIn(out)
  for (const meal of BATCH_MEALS) {
    for (const [first, second] of BATCH_PAIRS) {
      const source = free(out, first, meal, o)
      if (!source) continue
      const target = free(out, second, meal, o)
      // The day after only takes the leftovers when the week type didn't ask for a type there.
      const withLeftovers = !!target && target.dishes.every((d) => !(d as RecipeDish).fromWeekType)
      const lastDay = daysBefore + (withLeftovers ? second : first)
      const cooked: RecipeDish[] = []
      for (const d of source.dishes as RecipeDish[]) {
        if (!o.keeps || o.keeps(d.recipeId, lastDay)) {
          cooked.push(d)
          continue
        }
        const other = o.replace?.(first, meal, d, lastDay, used) ?? null
        if (!other) break
        used.delete(d.recipeId)
        used.add(other.recipeId)
        cooked.push(other)
      }
      if (cooked.length !== source.dishes.length) continue
      out[first][meal] = { ...source, dishes: cooked.map((d) => ({ ...d, batchDate })) }
      if (!withLeftovers) continue
      for (const d of target!.dishes) if (d.kind === 'recipe') used.delete(d.recipeId)
      out[second][meal] = {
        ...(target!.servings != null ? { servings: target!.servings } : {}),
        dishes: cooked.map((d, dishPosition) => {
          const { batchDate: _b, why: _w, replaced: _r, fromWeekType: _t, ...rest } = d
          return { ...rest, variant: 'leftover', leftoverOf: { day: first, meal, dishPosition } } as RecipeDish
        }),
      }
    }
  }
  return out
}
