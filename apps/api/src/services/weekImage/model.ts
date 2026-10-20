import type { DayMenu, Dish } from '@ona/shared'
import { DAY_NAME_ES, MEAL_LABEL_ES, MEAL_ORDER, MONTHS_ES, plusDays, weekRangeEs, type WeekMenuInput } from '../menuText.js'

/**
 * Pure: a week's menu → what the WhatsApp week image shows (2026-10-15,
 * Miguel: one picture of the week instead of the long text). No layout
 * numbers here — `render.ts` turns this into pixels.
 *
 * Two formats, both approved prototypes:
 * - **A**: up to two meal columns with at most one dish per slot (the usual
 *   comida + cena) — a square photo left of the name.
 * - **B**: anything else (desayuno/merienda columns, slots with 2+ dishes) —
 *   photo on top of the cell, name below, the second dish as «+ Nombre» and
 *   «+N más» beyond that.
 */

export type WeekImageFormat = 'A' | 'B'
/** The meals the image knows an icon for; anything else gets the plate. */
export type MealIcon = 'breakfast' | 'lunch' | 'snack' | 'dinner' | 'plate'

export interface WeekImageDish {
  /** As the text digest writes it, «(sobras)» / «(del congelador)» included. */
  name: string
  /** Recipe dishes only: the photo comes from the recipe. Notes have none. */
  recipeId: string | null
}

export interface WeekImageCell {
  /** First two dishes of the slot, in menu order. Empty = nothing planned for that meal. */
  dishes: WeekImageDish[]
  /** Dishes beyond the first two («+N más»). */
  more: number
}

export interface WeekImageRow {
  dayIndex: number
  /** «Lun», «Mié»… */
  dayShort: string
  /** «15 oct» */
  dateLabel: string
  isToday: boolean
  /** Before today (Europe/Madrid): drawn faded. Past days with nothing are left out (PRO-244). */
  isPast: boolean
  /** `skipped` → «Sin cocinar»; `empty` → nothing planned at all that day. */
  kind: 'menu' | 'skipped' | 'empty'
  /** One per column (only for `menu` rows). */
  cells: WeekImageCell[]
}

export interface WeekImageColumn {
  meal: string
  /** «Desayuno», «Comida»… */
  label: string
  icon: MealIcon
}

export interface WeekImageModel {
  format: WeekImageFormat
  /** «Del 12 al 18 de octubre · comida y cena» */
  subtitle: string
  columns: WeekImageColumn[]
  rows: WeekImageRow[]
}

/** More than this many meal columns don't fit on a phone-sized picture. */
export const MAX_COLUMNS = 4
export const DISHES_SHOWN = 2

const DAY_SHORT_ES = DAY_NAME_ES.map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3))
const MONTH_SHORT_ES = MONTHS_ES.map((m) => m.slice(0, 3))
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Emoji in a dish name would come out as empty boxes (the image fonts have
 * no emoji); a free-text note like «Pizza 🍕» keeps its words.
 */
export function stripEmoji(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function imageDish(d: Dish | null | undefined): WeekImageDish | null {
  if (!d || typeof d !== 'object') return null
  if (d.kind === 'note') {
    const text = stripEmoji(d.text ?? '')
    return text ? { name: text, recipeId: null } : null
  }
  if (d.kind === 'recipe') {
    const base = stripEmoji(d.recipeName?.trim() || '') || 'Receta sin nombre'
    const name = d.variant === 'freezer' ? `${base} (del congelador)` : d.variant === 'leftover' ? `${base} (sobras)` : base
    return { name, recipeId: d.recipeId || null }
  }
  return null
}

function slotDishes(day: DayMenu | null | undefined, meal: string): WeekImageDish[] {
  const dishes = day && typeof day === 'object' ? day[meal]?.dishes : null
  if (!Array.isArray(dishes)) return []
  return dishes.map(imageDish).filter((x): x is WeekImageDish => Boolean(x))
}

/** «desayuno, comida y cena» */
function joinEs(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/**
 * `today` is the Europe/Madrid date (`YYYY-MM-DD`). Returns null when the
 * week has nothing to show (no dish and no skipped day): the caller sends
 * the text instead.
 */
export function buildWeekImageModel(menu: WeekMenuInput, opts: { today: string }): WeekImageModel | null {
  const days = Array.isArray(menu.days) ? menu.days : []
  const weekStart = menu.weekStart.slice(0, 10)
  const today = opts.today.slice(0, 10)
  const skipped = new Set(menu.skippedDays ?? [])

  // Columns: every meal any (non-skipped) day has a dish for, in meal order,
  // unknown meal keys after the known ones.
  const used: string[] = []
  for (let i = 0; i < 7; i++) {
    if (skipped.has(i)) continue
    const day = days[i]
    if (!day || typeof day !== 'object') continue
    for (const meal of Object.keys(day)) {
      if (!used.includes(meal) && slotDishes(day, meal).length > 0) used.push(meal)
    }
  }
  const known = MEAL_ORDER.filter((m) => used.includes(m)) as string[]
  const meals = [...known, ...used.filter((m) => !known.includes(m))].slice(0, MAX_COLUMNS)

  if (meals.length === 0 && skipped.size === 0) return null

  const columns: WeekImageColumn[] = meals.map((meal) => ({
    meal,
    label: capitalize(MEAL_LABEL_ES[meal] ?? meal),
    icon: (MEAL_ORDER as readonly string[]).includes(meal) ? (meal as MealIcon) : 'plate',
  }))

  let maxDishes = 0
  const rows: WeekImageRow[] = Array.from({ length: 7 }, (_, i) => {
    const date = plusDays(weekStart, i)
    const base = {
      dayIndex: i,
      dayShort: DAY_SHORT_ES[i],
      dateLabel: `${Number(date.slice(8, 10))} ${MONTH_SHORT_ES[Number(date.slice(5, 7)) - 1]}`,
      isToday: date === today,
      isPast: date < today,
    }
    if (skipped.has(i)) return { ...base, kind: 'skipped' as const, cells: [] }
    const cells = meals.map((meal) => {
      const all = slotDishes(days[i], meal)
      maxDishes = Math.max(maxDishes, all.length)
      return { dishes: all.slice(0, DISHES_SHOWN), more: Math.max(0, all.length - DISHES_SHOWN) }
    })
    const empty = cells.every((c) => c.dishes.length === 0)
    return { ...base, kind: empty ? ('empty' as const) : ('menu' as const), cells: empty ? [] : cells }
  })
    // PRO-244: a day that already went by with nothing on it is left out, so
    // a first menu made mid-week (past days not generated) starts today.
    .filter((r) => !(r.isPast && r.kind === 'empty'))

  const format: WeekImageFormat = columns.length <= 2 && maxDishes <= 1 ? 'A' : 'B'
  const range = capitalize(weekRangeEs(weekStart))
  const subtitle = columns.length > 0
    ? `${range} · ${joinEs(columns.map((c) => c.label.toLowerCase()))}`
    : range
  return { format, subtitle, columns, rows }
}

/** Recipe ids whose photo the image shows (first dish of a cell in B, every dish in A). */
export function photoRecipeIds(model: WeekImageModel): string[] {
  const ids = new Set<string>()
  for (const row of model.rows) {
    for (const cell of row.cells) {
      const first = cell.dishes[0]
      if (first?.recipeId) ids.add(first.recipeId)
    }
  }
  return [...ids]
}
