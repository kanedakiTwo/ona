import type { DayMenu, LockedSlots, MealSlot, RecipeDish } from '@ona/shared'
import { isTaperDish } from '@ona/shared'

/**
 * PRO-223 · «El táper de mañana» (D-069). «Mañana como fuera: haz ración y
 * media de la cena y te llevas el táper.» A meal marked as táper becomes the
 * previous day's dinner as a leftover (`variant: 'leftover'`, the hueco de
 * sobras that already exists) with `servings` = tápers and `taper` = tápers.
 * Shopping adds those rations to that dinner's recipe once
 * (`sumDinersByRecipe`; `withLeftoverBatches` keeps táper leftovers even when
 * the dinner has «Solo hoy»), so nothing is bought twice.
 * Pure: returns copies.
 */

export const MAX_TAPERS = 6

export type TaperResult = { ok: true; days: DayMenu[] } | { ok: false; status: 400 | 404 | 409; error: string }

const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** The dinner a táper on `day` comes from: the day before, in the same week. */
export function taperSource(day: number): { day: number; meal: 'dinner' } | null {
  return day >= 1 && day <= 6 ? { day: day - 1, meal: 'dinner' } : null
}

export function applyTaper(days: DayMenu[], day: number, meal: string, count = 1, locked: LockedSlots = {}): TaperResult {
  const n = Math.round(count)
  if (!(n >= 1 && n <= MAX_TAPERS)) return { ok: false, status: 400, error: `Entre 1 y ${MAX_TAPERS} tápers.` }
  const source = taperSource(day)
  if (!source) {
    return { ok: false, status: 409, error: 'El lunes no tiene en este menú la cena del día anterior: el táper sale de la cena del domingo de la semana pasada.' }
  }
  if (meal === 'dinner') return { ok: false, status: 400, error: 'El táper es para una comida del día, no para la cena.' }
  if (locked[String(day)]?.[meal]) return { ok: false, status: 400, error: 'Esa comida está fijada: desfíjala primero.' }
  const src = days[source.day]?.dinner
  const planned: RecipeDish[] = []
  ;(src?.dishes ?? []).forEach((d, pos) => {
    if (d.kind === 'recipe' && d.variant !== 'leftover' && !isTaperDish(d)) {
      planned.push({ ...d, variant: 'leftover', leftoverOf: { day: source.day, meal: 'dinner', dishPosition: pos } })
    }
  })
  if (planned.length === 0) {
    return { ok: false, status: 404, error: `El ${DAY_NAMES[source.day]} no hay una cena con receta para hacer de más.` }
  }
  const next = days.map((d) => ({ ...(d ?? {}) }))
  next[day][meal] = { servings: n, taper: n, dishes: planned } as MealSlot
  return { ok: true, days: next }
}

/** Undo: the meal is left empty for the household to fill (the dinner goes back to its own rations). */
export function removeTaper(days: DayMenu[], day: number, meal: string): TaperResult {
  const slot = days[day]?.[meal]
  if (!slot?.taper) return { ok: false, status: 404, error: 'Esa comida no es un táper.' }
  const next = days.map((d) => ({ ...(d ?? {}) }))
  next[day][meal] = { dishes: [] }
  return { ok: true, days: next }
}

/**
 * Template «días de táper» (`template.taperDays`: Spanish day names, e.g.
 * ['martes', 'jueves']): after generating, each of those days' lunch is a
 * táper of the dinner before. Skips Monday, locked lunches, skipped days and
 * days whose dinner before has no recipe.
 */
const SPANISH_DAY: Record<string, number> = { lunes: 0, martes: 1, miercoles: 2, miércoles: 2, jueves: 3, viernes: 4, sabado: 5, sábado: 5, domingo: 6 }

export function taperDaysOf(rawTemplate: unknown): number[] {
  const list = (rawTemplate as { taperDays?: unknown } | null)?.taperDays
  if (!Array.isArray(list)) return []
  return [...new Set(list.map((d) => SPANISH_DAY[String(d).toLowerCase()]).filter((d): d is number => d !== undefined))].sort()
}

export function applyTemplateTapers(days: DayMenu[], rawTemplate: unknown, locked: LockedSlots = {}, skippedDays: ReadonlySet<number> | readonly number[] = []): DayMenu[] {
  const skipped = new Set(skippedDays)
  let out = days
  for (const day of taperDaysOf(rawTemplate)) {
    if (skipped.has(day) || skipped.has(day - 1)) continue
    const r = applyTaper(out, day, 'lunch', 1, locked)
    if (r.ok) out = r.days
  }
  return out
}

/** Tápers of `day + 1` that come from `day`'s dinner: what to remind tonight. */
export function taperTomorrow(days: DayMenu[], day: number): { recipeNames: string[]; count: number } | null {
  const tomorrow = days[day + 1]
  if (!tomorrow) return null
  let count = 0
  const names = new Set<string>()
  for (const slot of Object.values(tomorrow)) {
    if (!slot?.taper) continue
    const fromTonight = (slot.dishes ?? []).filter((d) => d.kind === 'recipe' && d.leftoverOf?.day === day && d.leftoverOf.meal === 'dinner')
    if (fromTonight.length === 0) continue
    for (const d of fromTonight) if (d.kind === 'recipe') names.add(d.recipeName ?? 'la cena')
    count += slot.taper
  }
  return count > 0 ? { recipeNames: [...names], count } : null
}

/** «🥡 Mañana te llevas táper: haz 1 ración más de *Lentejas*.» */
export function taperReminderLine(t: { recipeNames: string[]; count: number }): string {
  const what = t.recipeNames.length ? t.recipeNames.map((n) => `*${n}*`).join(' y ') : 'la cena'
  return `🥡 Mañana te llevas táper: haz ${t.count === 1 ? '1 ración más' : `${t.count} raciones más`} de ${what}.`
}
