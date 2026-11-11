/**
 * «Semana tipo» (D-182): what a household usually eats each day, said once
 * («los viernes por la noche, pizza»; «los jueves, una semana ceviche y otra
 * carpaccio»), and the menu of every week comes out of it. One per household
 * (`household_week_types`), whoever generates. Design:
 * docs/superpowers/specs/2026-11-11-semana-tipo-design.md.
 *
 * A slot (day × meal) is «libre» (no options: Mimo picks, as before), «no
 * hay» (`off`: that meal isn't planned that day) or has up to 4 options,
 * taken **by turns** (one a week, in order, from the week it was saved —
 * «cada 2» is `[Pizza, Cualquier receta]`) or **together** (all in the same
 * meal). Diners and number of dishes live in the slot too.
 */
import { z } from 'zod'
import { DISH_TYPE_KEYS, dishTypeInfo } from '../constants/dishTypes.js'
import { MEALS, type Meal } from '../constants/enums.js'
import { COOKING_WEEKDAYS } from './cookingTime.js'
import { fixedMealFor, fixedMealItemSchema, type FixedMeal, type FixedMealItem } from './fixedMeals.js'

export const WEEK_TYPE_MAX_OPTIONS = 4

export type WeekTypeOption =
  | { kind: 'type'; type: string }
  | { kind: 'recipe'; recipeId: string; name: string }
  | { kind: 'fixed'; label: string; items: FixedMealItem[] }
  | { kind: 'taper' }
  | { kind: 'any' }

export interface WeekTypeSlot {
  /** «No hay <comida> este día». */
  off?: boolean
  /** Up to 4; absent or empty = «Cualquier receta». */
  options?: WeekTypeOption[]
  /** All the options in the same meal (one dish each); default: by turns. */
  together?: boolean
  diners?: number
  dishes?: 1 | 2 | 3
  /** Monday (YYYY-MM-DD) of the week it was saved: that week takes the first option. */
  since?: string
}

/** Index 0 = Monday … 6 = Sunday. A meal missing from a day takes `defaultWeekTypeSlot`. */
export type WeekTypeDays = Array<Partial<Record<Meal, WeekTypeSlot>>>

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const weekTypeOptionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('type'), type: z.enum(DISH_TYPE_KEYS as unknown as [string, ...string[]]) }),
  z.object({ kind: z.literal('recipe'), recipeId: z.string().min(1).max(64), name: z.string().trim().min(1).max(160) }),
  z.object({ kind: z.literal('fixed'), label: z.string().trim().min(1).max(60), items: z.array(fixedMealItemSchema).max(10) }),
  z.object({ kind: z.literal('taper') }),
  z.object({ kind: z.literal('any') }),
])

export const weekTypeSlotSchema = z.object({
  off: z.boolean().optional(),
  options: z.array(weekTypeOptionSchema).max(WEEK_TYPE_MAX_OPTIONS).optional(),
  together: z.boolean().optional(),
  diners: z.number().int().min(1).max(24).optional(),
  dishes: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  since: isoDate.optional(),
})

/** Lunch and dinner every day; breakfast and snack are opt-in (as the generator's default plantilla). */
export function defaultWeekTypeSlot(meal: Meal): WeekTypeSlot {
  return meal === 'lunch' || meal === 'dinner' ? {} : { off: true }
}

export function weekTypeSlotAt(days: WeekTypeDays | null | undefined, day: number, meal: Meal): WeekTypeSlot {
  return days?.[day]?.[meal] ?? defaultWeekTypeSlot(meal)
}

/** Seven days with every meal written out (what the store saves). */
export function fullWeekTypeDays(days?: WeekTypeDays | null): WeekTypeDays {
  return Array.from({ length: 7 }, (_, d) => Object.fromEntries(MEALS.map((m) => [m, { ...weekTypeSlotAt(days, d, m) }])) as Partial<Record<Meal, WeekTypeSlot>>)
}

/** The táper of the dinner before: breakfast, lunch or snack, Tuesday to Sunday (PRO-223). */
export function taperAllowedAt(day: number, meal: Meal): boolean {
  return day >= 1 && day <= 6 && meal !== 'dinner'
}

/** Pure: why a slot can't be saved there, or null. */
export function weekTypeSlotError(day: number, meal: Meal, slot: WeekTypeSlot): string | null {
  const options = slot.options ?? []
  if (options.some((o) => o.kind === 'taper')) {
    if (!taperAllowedAt(day, meal)) return 'El táper de la cena va en el desayuno, la comida o la merienda, de martes a domingo.'
    if (options.length > 1) return 'El táper tiene que ser la única opción de esa comida.'
  }
  return null
}

/** Whole weeks from Monday `from` to Monday `to` (negative when `to` is earlier). */
export function weeksBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T12:00:00Z`)
  const b = Date.parse(`${to.slice(0, 10)}T12:00:00Z`)
  return Math.round((b - a) / (7 * 24 * 3600 * 1000))
}

/**
 * Pure: the options a slot takes the week starting `weekStart`: all of them
 * when together; by turns, the one of that week counting from `since` (the
 * first one that week, the second the next…, whether or not those weeks were
 * cooked). No options → [] («Cualquier receta»).
 */
export function weekTypeOptionsFor(slot: WeekTypeSlot, weekStart: string): WeekTypeOption[] {
  const options = slot.options ?? []
  if (options.length === 0 || slot.off) return []
  if (slot.together) return options
  const n = options.length
  const turn = slot.since ? weeksBetween(slot.since, weekStart) : 0
  return [options[((turn % n) + n) % n]]
}

/** «Pizza», «Yogur con cereales», «Táper de la cena», «Cualquier receta». */
export function weekTypeOptionLabel(o: WeekTypeOption): string {
  if (o.kind === 'type') return dishTypeInfo(o.type)?.label ?? o.type
  if (o.kind === 'recipe') return o.name
  if (o.kind === 'fixed') return o.label
  if (o.kind === 'taper') return 'Táper de la cena'
  return 'Cualquier receta'
}

/** A JSON string that doesn't depend on key order, to compare slots. */
export function stableSlotJson(slot: WeekTypeSlot | undefined): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined).map((k) => [k, canon((v as any)[k])]))
    }
    return v
  }
  return JSON.stringify(canon(slot ?? {}))
}

// ─── Perfil → «Plantilla semanal» (phase 1 only) ──────────────────────────
// Until «Tu semana tipo» replaces it (phase 2), the profile's plantilla card
// is a view of the week type: its grid (diners), its dishes per meal, its
// «Comidas fijas» and its «Días de táper». Saving writes only the slots the
// person changed in the card, through PUT /households/me/week-type/:day/:meal.

/** The profile's Spanish keys (`mealTemplate`, `taperDays`). */
export const PLANTILLA_DAYS = COOKING_WEEKDAYS
export const PLANTILLA_MEALS: Record<Meal, string> = { breakfast: 'desayuno', lunch: 'almuerzo', snack: 'merienda', dinner: 'cena' }

export interface PlantillaView {
  /** Spanish day → Spanish meal → diners (absent = that meal isn't planned). */
  mealTemplate: Record<string, Record<string, number>>
  mealDishCounts: Partial<Record<Meal, 1 | 2 | 3>>
  fixedMeals: FixedMeal[]
  /** Days whose lunch is a táper of the dinner before. */
  taperDays: string[]
}

/** Pure: the week type as the profile's plantilla card shows it. */
export function plantillaFromWeekType(days: WeekTypeDays | null | undefined, defaultDiners: number): PlantillaView {
  const mealTemplate: PlantillaView['mealTemplate'] = {}
  const mealDishCounts: PlantillaView['mealDishCounts'] = {}
  const fixedByMeal = new Map<Meal, FixedMeal>()
  const taperDays: string[] = []
  PLANTILLA_DAYS.forEach((dayKey, d) => {
    mealTemplate[dayKey] = {}
    for (const m of MEALS) {
      const slot = weekTypeSlotAt(days, d, m)
      if (slot.off) continue
      mealTemplate[dayKey][PLANTILLA_MEALS[m]] = slot.diners ?? defaultDiners
      if (slot.dishes && slot.dishes > 1 && !mealDishCounts[m]) mealDishCounts[m] = slot.dishes
      const options = slot.options ?? []
      const fixed = options.length === 1 && options[0].kind === 'fixed' ? options[0] : null
      if (fixed) {
        const prev = fixedByMeal.get(m)
        if (!prev) fixedByMeal.set(m, { meal: m, days: [dayKey], label: fixed.label, items: fixed.items.map((i) => ({ ...i })) })
        else if (prev.label === fixed.label) prev.days.push(dayKey)
      }
      if (m === 'lunch' && options.length === 1 && options[0].kind === 'taper') taperDays.push(dayKey)
    }
  })
  return { mealTemplate, mealDishCounts, fixedMeals: [...fixedByMeal.values()], taperDays }
}

/**
 * Pure: the slots the person changed in the plantilla card (`before` is what
 * it showed, `after` what they leave), each written whole. Anything the card
 * doesn't show (dish types, recipes, turns) is kept as it is.
 */
export function plantillaEdits(
  days: WeekTypeDays | null | undefined,
  before: PlantillaView,
  after: PlantillaView,
  weekStart: string,
): Array<{ day: number; meal: Meal; slot: WeekTypeSlot }> {
  const out: Array<{ day: number; meal: Meal; slot: WeekTypeSlot }> = []
  PLANTILLA_DAYS.forEach((dayKey, d) => {
    for (const m of MEALS) {
      const prev = weekTypeSlotAt(days, d, m)
      const next: WeekTypeSlot = { ...prev }
      const countBefore = before.mealTemplate[dayKey]?.[PLANTILLA_MEALS[m]] ?? 0
      const countAfter = after.mealTemplate[dayKey]?.[PLANTILLA_MEALS[m]] ?? 0
      if (countBefore !== countAfter) {
        if (countAfter > 0) {
          delete next.off
          next.diners = countAfter
        } else {
          next.off = true
          delete next.diners
        }
      }
      if ((before.mealDishCounts[m] ?? 1) !== (after.mealDishCounts[m] ?? 1)) {
        const n = after.mealDishCounts[m] ?? 1
        if (n > 1) next.dishes = n
        else delete next.dishes
      }
      let options = next.options ?? []
      const fixedBefore = fixedMealFor(before.fixedMeals, d, m)
      const fixedAfter = fixedMealFor(after.fixedMeals, d, m)
      if (JSON.stringify(fixedBefore) !== JSON.stringify(fixedAfter)) {
        options = options.filter((o) => o.kind !== 'fixed')
        if (fixedAfter) {
          options = [{ kind: 'fixed', label: fixedAfter.label, items: fixedAfter.items.map((i) => ({ ...i })) }]
          delete next.off
        }
      }
      if (m === 'lunch' && before.taperDays.includes(dayKey) !== after.taperDays.includes(dayKey)) {
        options = options.filter((o) => o.kind !== 'taper')
        if (after.taperDays.includes(dayKey) && taperAllowedAt(d, m)) options = [{ kind: 'taper' }]
      }
      if (JSON.stringify(options) !== JSON.stringify(next.options ?? [])) {
        if (options.length) next.options = options
        else delete next.options
        if (options.length < 2) delete next.together
        next.since = weekStart
      }
      if (stableSlotJson(next) !== stableSlotJson(prev)) out.push({ day: d, meal: m, slot: next })
    }
  })
  return out
}
