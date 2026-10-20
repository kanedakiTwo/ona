import type { DayMenu, Dish } from '@ona/shared'
import { dishLabel, mealEntriesForDay, MEAL_LABEL_ES } from '../menuText.js'

/**
 * PRO-183 (2026-10-19): Mimo said minutes, servings and amounts from memory
 * («unos 15 minutos», «para 4») while the app showed 25 min and 2 raciones.
 * The menu tools now hand the model, per meal, the servings the app shows
 * and, per dish, the total and hands-on minutes of its recipe — the same
 * numbers as the menu page — so it cites them instead of guessing.
 * Pure helpers; the skills load the recipes and the household.
 */

export interface RecipeTimes {
  totalTime?: number | null
  activeTime?: number | null
  prepTime?: number | null
}

/** Diners of the household as the menu page counts them (`apps/web/src/app/menu/page.tsx`): adults + kids, at least 1, 2 when unknown. */
export function householdDiners(user: { adults?: number | null; kidsCount?: number | null } | null | undefined): number {
  const n = (user?.adults ?? 0) + (user?.kidsCount ?? 0)
  return Math.max(1, n || 2)
}

type Slot = { servings?: number | null; dishes?: Dish[] } | undefined

function override(slot: Slot): number | null {
  return typeof slot?.servings === 'number' && slot.servings > 0 ? slot.servings : null
}

function firstRecipe(slot: Slot) {
  return slot?.dishes?.find((d) => d.kind === 'recipe') as Extract<Dish, { kind: 'recipe' }> | undefined
}

/**
 * Servings the menu page shows for a meal («Comida · 28 min · 3 raciones»):
 * mirror of `batchServings` in `apps/web/src/lib/menuDay.ts` (PRO-75) — the
 * slot's «Solo hoy: N», or the household's diners plus every planned
 * leftover of that dish (the táper is cooked in the same batch); a leftover
 * slot counts only its own diners.
 */
export function mealServings(days: readonly (DayMenu | null | undefined)[], dayIndex: number, meal: string, defaultDiners: number): number {
  const slot = days[dayIndex]?.[meal as keyof DayMenu] as Slot
  const own = override(slot) ?? defaultDiners
  const first = firstRecipe(slot)
  if (!first || first.variant === 'leftover' || override(slot) != null) return own
  let total = own
  for (const d of days) {
    for (const s of Object.values(d ?? {}) as Slot[]) {
      const dish = firstRecipe(s)
      if (dish?.variant === 'leftover' && dish.recipeId === first.recipeId && dish.leftoverOf?.day === dayIndex && dish.leftoverOf?.meal === meal) {
        total += override(s) ?? defaultDiners
      }
    }
  }
  return total
}

/** "25 min en total, 10 de trabajo" / "25 min" / null — total is `totalTime ?? prepTime`, as the menu page. */
export function timesLabel(t: RecipeTimes | undefined): string | null {
  const total = t?.totalTime ?? t?.prepTime ?? null
  if (total == null || total <= 0) return null
  const active = t?.activeTime
  return active != null && active > 0 && active < total ? `${total} min en total, ${active} de trabajo` : `${total} min`
}

/** Recipe ids of the dishes cooked in these days (leftovers and tápers aren't cooked again). */
export function cookedRecipeIds(days: readonly (DayMenu | null | undefined)[]): string[] {
  const ids = new Set<string>()
  for (const day of days) {
    for (const slot of Object.values(day ?? {}) as Slot[]) {
      for (const d of slot?.dishes ?? []) {
        if (d.kind === 'recipe' && d.recipeId && d.variant !== 'leftover' && d.variant !== 'freezer') ids.add(d.recipeId)
      }
    }
  }
  return [...ids]
}

/**
 * One line per meal of `days[dayIndex]` with the facts the app shows:
 * `cena [solo hoy: 4] · 4 raciones: Pollo a la plancha (25 min en total, 10 de trabajo) + Ensalada (5 min)`.
 * Without facts for a dish its name goes alone; leftovers and tápers carry no minutes.
 */
export function mealLinesWithFacts(
  days: readonly (DayMenu | null | undefined)[],
  dayIndex: number,
  times: ReadonlyMap<string, RecipeTimes>,
  defaultDiners: number,
): string[] {
  const day = days[dayIndex]
  if (!day) return []
  const out: string[] = []
  for (const e of mealEntriesForDay(day)) {
    const slot = day[e.meal as keyof DayMenu] as Slot
    const diners = override(slot) != null ? ` [solo hoy: ${override(slot)}]` : ''
    const hasRecipe = (slot?.dishes ?? []).some((d) => d.kind === 'recipe')
    const servings = hasRecipe ? ` · ${mealServings(days, dayIndex, e.meal, defaultDiners)} raciones` : ''
    const dishes = (slot?.dishes ?? [])
      .map((d) => {
        const label = dishLabel(d)
        if (!label) return null
        if (d.kind !== 'recipe' || d.variant === 'leftover' || d.variant === 'freezer') return label
        const t = timesLabel(times.get(d.recipeId))
        return t ? `${label} (${t})` : label
      })
      .filter((x): x is string => Boolean(x))
    out.push(`${MEAL_LABEL_ES[e.meal] ?? e.meal}${diners}${servings}: ${dishes.join(' + ')}`)
  }
  return out
}

