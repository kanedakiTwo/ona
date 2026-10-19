/**
 * Comidas fijas (PRO-218, D-069): «todos los días desayuno yogur con cereales
 * y un par de galletas» se dice una vez. A meal of some days is marked
 * «fija» with a short list of things and amounts per person: the menu
 * generator leaves it alone, the day shows «Fijo: yogur con cereales» and
 * the shopping list adds the whole week's amounts.
 *
 * Stored in `userSettings.template.fixedMeals` (the profile's plantilla blob).
 */
import { z } from 'zod'
import { COOKING_WEEKDAYS, type CookingWeekday } from './cookingTime.js'
import type { BuyableUnit } from './shopping.js'

export const FIXED_MEALS = ['breakfast', 'lunch', 'snack', 'dinner'] as const
export type FixedMealType = (typeof FIXED_MEALS)[number]

export const FIXED_MEAL_LABELS: Record<FixedMealType, string> = {
  breakfast: 'Desayuno',
  lunch: 'Comida',
  snack: 'Merienda',
  dinner: 'Cena',
}

export const FIXED_ITEM_UNITS = ['u', 'g', 'ml'] as const satisfies readonly BuyableUnit[]
export type FixedItemUnit = (typeof FIXED_ITEM_UNITS)[number]

export const FIXED_UNIT_LABELS: Record<FixedItemUnit, string> = { u: 'unidades', g: 'g', ml: 'ml' }

export const FIXED_LABEL_MAX = 60
export const FIXED_ITEMS_MAX = 10

export interface FixedMealItem {
  /** «yogur natural», «cereales», «galletas». */
  name: string
  /** Per person, per day. */
  quantity: number
  unit: FixedItemUnit
}

export interface FixedMeal {
  meal: FixedMealType
  /** Days it applies to (`lunes`…`domingo`). */
  days: CookingWeekday[]
  /** «Yogur con cereales»: the day shows «Fijo: <label>». */
  label: string
  items: FixedMealItem[]
}

export const fixedMealItemSchema = z.object({
  name: z.string().trim().min(1).max(60),
  quantity: z.number().positive().max(5000),
  unit: z.enum(FIXED_ITEM_UNITS),
})

export const fixedMealSchema = z.object({
  meal: z.enum(FIXED_MEALS),
  days: z.array(z.enum(COOKING_WEEKDAYS)).min(1).max(7),
  label: z.string().trim().min(1).max(FIXED_LABEL_MAX),
  items: z.array(fixedMealItemSchema).min(1).max(FIXED_ITEMS_MAX),
})

/** One fixed meal per meal type at most. */
export const fixedMealsSchema = z
  .array(fixedMealSchema)
  .max(FIXED_MEALS.length)
  .refine((list) => new Set(list.map((f) => f.meal)).size === list.length, 'una sola comida fija por tipo de comida')

/** Pure: the valid fixed meals of a template blob (anything malformed is dropped). */
export function fixedMealsFromTemplate(raw: unknown): FixedMeal[] {
  const blob = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { fixedMeals?: unknown }) : null
  if (!blob || !Array.isArray(blob.fixedMeals)) return []
  const out: FixedMeal[] = []
  for (const f of blob.fixedMeals) {
    const parsed = fixedMealSchema.safeParse(f)
    if (parsed.success && !out.some((x) => x.meal === parsed.data.meal)) out.push({ ...parsed.data, days: [...new Set(parsed.data.days)] })
  }
  return out
}

/** The fixed meal for a day (0 = Monday) and meal, or null. */
export function fixedMealFor(fixed: readonly FixedMeal[], dayIndex: number, meal: string): FixedMeal | null {
  const day = COOKING_WEEKDAYS[dayIndex]
  return fixed.find((f) => f.meal === meal && f.days.includes(day)) ?? null
}

/** «Fijo: yogur con cereales». */
export function fixedNoteText(f: Pick<FixedMeal, 'label'>): string {
  return `Fijo: ${f.label.trim()}`
}

/** «1 yogur natural, 40 g de cereales, 2 galletas». */
export function fixedItemsText(items: readonly FixedMealItem[]): string {
  return items
    .map((i) => {
      const q = Number.isInteger(i.quantity) ? String(i.quantity) : String(i.quantity).replace('.', ',')
      return i.unit === 'u' ? `${q} ${i.name}` : `${q} ${i.unit} de ${i.name}`
    })
    .join(', ')
}
