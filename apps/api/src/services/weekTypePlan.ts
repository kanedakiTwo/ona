/**
 * «Semana tipo» (D-182 §5) → what the generator does with each slot of one
 * week. Pure. The order of what wins (design §5):
 *
 *   1. a «sin cocinar» day, 2. a meal out this week («¿Alguna comida
 *   fuera?»), 3. a locked or eaten slot — all handled by the generator as
 *   before; 4. «No hay» (unless «¿Viene alguien?» adds that meal this week,
 *   `applyWeekPlan`); 5. the school menu, a filter inside 6; 6. the option of
 *   the turn, or all of them together; 7. a free slot, as before.
 *
 * Each option becomes a dish spec: a dish type (the draw only looks at
 * recipes of that type), a preset dish (a concrete recipe, or something
 * fixed with no recipe) or free. A táper is drawn free and turned into the
 * táper of the dinner before afterwards (PRO-223).
 */
import type { DayMenu, DayTemplate, Dish, LockedSlots, Meal, MealDishCounts, RecipeDish, WeekTypeDays, WeekTypeOption } from '@ona/shared'
import { MEALS, dishTypeInfo, fixedNoteText, isDishType, taperAllowedAt, weekTypeOptionsFor, weekTypeSlotAt } from '@ona/shared'
import { compileRestrictions, violatesRestrictions } from './dietaryRestrictions.js'
import type { RecipeWithCourse } from './matchableRecipes.js'
import { applyTaper } from './taper.js'

/** `anyCourse`: a free dish among options together (no starter/main/dessert order). */
export type DishSpec = { kind: 'free'; anyCourse?: boolean } | { kind: 'type'; type: string } | { kind: 'preset'; dish: Dish }

/** A concrete recipe of the week type that breaks someone's allergy or diet: the slot goes free and says so (PRO-345). */
export interface WeekTypeConflict {
  dayIndex: number
  meal: Meal
  dish: string
}

export interface WeekTypeWeekPlan {
  /** On/off per slot («No hay» = off). */
  template: DayTemplate[]
  /** The slot's diners, when it has them. */
  mealDiners: Record<Meal, number>[]
  /** Dishes per meal, per day. */
  dishCounts: MealDishCounts[]
  /** `${day}:${meal}` → one spec per dish, only for slots that ask for something. */
  specs: Record<string, DishSpec[]>
  /** Slots that are the táper of the dinner before this week. */
  tapers: Array<{ dayIndex: number; meal: Meal }>
  conflicts: WeekTypeConflict[]
  warnings: string[]
}

export const slotKey = (dayIndex: number, meal: string) => `${dayIndex}:${meal}`

/** Pure: on/off, diners and dish counts of a plain plantilla (`customTemplate`) as a week type with no options. */
export function weekTypeFromTemplate(template: DayTemplate[]): WeekTypeDays {
  return Array.from({ length: 7 }, (_, d) => Object.fromEntries(MEALS.map((m) => [m, template[d]?.[m] ? {} : { off: true }])))
}

/**
 * Pure: the plan of the week starting `weekStart`. `recipes` are the
 * household's matchable recipes (a concrete recipe must be among them and not
 * vetoed this week); `restrictions` every member's allergies and diets.
 */
export function planWeekType(
  days: WeekTypeDays,
  weekStart: string,
  opts: { recipes: readonly RecipeWithCourse[]; restrictions: readonly string[]; bannedRecipeIds?: ReadonlySet<string> },
): WeekTypeWeekPlan {
  const template: DayTemplate[] = []
  const mealDiners: Record<Meal, number>[] = []
  const dishCounts: MealDishCounts[] = []
  const specs: Record<string, DishSpec[]> = {}
  const tapers: WeekTypeWeekPlan['tapers'] = []
  const conflicts: WeekTypeConflict[] = []
  const warnings: string[] = []
  let rules: ReturnType<typeof compileRestrictions> | null = null
  const byId = new Map(opts.recipes.map((r) => [r.id, r]))

  const specOf = (o: WeekTypeOption, dayIndex: number, meal: Meal): DishSpec => {
    if (o.kind === 'type') return isDishType(o.type) ? { kind: 'type', type: o.type } : { kind: 'free' }
    if (o.kind === 'fixed') {
      // With what it carries: «Fijo: <name>» and its things go to the list
      // (PRO-218). With nothing: just its name, nothing on the list (PRO-1141).
      return {
        kind: 'preset',
        dish: o.items.length
          ? { kind: 'note', text: fixedNoteText(o), fixed: { items: o.items.map((i) => ({ ...i })) } }
          : { kind: 'note', text: o.label.trim(), fixedDish: true },
      }
    }
    if (o.kind === 'recipe') {
      const r = byId.get(o.recipeId)
      if (!r || opts.bannedRecipeIds?.has(r.id)) return { kind: 'free' }
      rules ??= compileRestrictions([...opts.restrictions])
      if (violatesRestrictions(r, rules)) {
        conflicts.push({ dayIndex, meal, dish: o.name })
        warnings.push(`week_type_recipe_restricted_${meal}_d${dayIndex}`)
        return { kind: 'free' }
      }
      return { kind: 'preset', dish: { kind: 'recipe', recipeId: r.id, recipeName: r.name, course: r.course ?? null, fixedDish: true } as RecipeDish }
    }
    if (o.kind === 'taper' && taperAllowedAt(dayIndex, meal)) tapers.push({ dayIndex, meal })
    return { kind: 'free' }
  }

  for (let d = 0; d < 7; d++) {
    template.push({})
    mealDiners.push({} as Record<Meal, number>)
    dishCounts.push({})
    for (const meal of MEALS) {
      const slot = weekTypeSlotAt(days, d, meal)
      template[d][meal] = !slot.off
      if (slot.off) continue
      if (slot.diners && slot.diners > 0) mealDiners[d][meal] = slot.diners
      if (slot.dishes && slot.dishes > 1) dishCounts[d][meal] = slot.dishes
      const options = weekTypeOptionsFor(slot, weekStart)
      if (options.length === 0) continue
      let list: DishSpec[]
      if (slot.together && options.length > 1) {
        list = options.map((o) => {
          const spec = specOf(o, d, meal)
          return spec.kind === 'free' ? { kind: 'free', anyCourse: true } : spec
        })
      } else {
        const first = specOf(options[0], d, meal)
        // Something fixed with no recipe is the whole meal (PRO-218); one
        // option in a meal of 2 or 3 dishes takes the first, the rest free.
        const count = first.kind === 'preset' && first.dish.kind === 'note' ? 1 : slot.dishes ?? 1
        list = [first, ...Array.from({ length: count - 1 }, () => ({ kind: 'free' }) as DishSpec)]
      }
      if (list.some((s) => s.kind !== 'free') || list.length !== (slot.dishes ?? 1)) specs[slotKey(d, meal)] = list
    }
  }
  return { template, mealDiners, dishCounts, specs, tapers, conflicts, warnings }
}

/** Pure: the recipes put whole by the week type (not drawn elsewhere in the week). */
export function presetRecipeIds(specs: Record<string, DishSpec[]>): Set<string> {
  const out = new Set<string>()
  for (const list of Object.values(specs)) for (const s of list) if (s.kind === 'preset' && s.dish.kind === 'recipe') out.add(s.dish.recipeId)
  return out
}

/** Pure: slots whose every dish is preset (the calorie target and the fridge dish leave them alone). */
export function presetSlots(specs: Record<string, DishSpec[]>): LockedSlots {
  const out: LockedSlots = {}
  for (const [key, list] of Object.entries(specs)) {
    if (!list.length || list.some((s) => s.kind !== 'preset')) continue
    const [d, meal] = key.split(':')
    out[d] = { ...(out[d] ?? {}), [meal]: true }
  }
  return out
}

/** Pure: the week's tápers (PRO-223) on the drawn week. Not on a locked slot, a «sin cocinar» day or a meal out this week. */
export function applyWeekTypeTapers(
  days: DayMenu[],
  tapers: WeekTypeWeekPlan['tapers'],
  opts: { locked?: LockedSlots; skippedDays?: ReadonlySet<number>; template?: DayTemplate[] } = {},
): DayMenu[] {
  let out = days
  for (const t of tapers) {
    if (opts.skippedDays?.has(t.dayIndex) || opts.skippedDays?.has(t.dayIndex - 1)) continue
    if (opts.template && !opts.template[t.dayIndex]?.[t.meal]) continue
    const r = applyTaper(out, t.dayIndex, t.meal, 1, opts.locked ?? {})
    if (r.ok) out = r.days
  }
  return out
}

const capitalise = (s: string) => {
  const t = s.trim()
  return t ? t[0].toLocaleUpperCase('es') + t.slice(1) : t
}

/** Pure: the drawn dish of a slot whose concrete recipe breaks a restriction says why (PRO-345's «En lugar de …»). */
export function markWeekTypeConflicts(days: DayMenu[], conflicts: readonly WeekTypeConflict[]): DayMenu[] {
  if (conflicts.length === 0) return days
  const out = days.map((d) => ({ ...(d ?? {}) }))
  for (const c of conflicts) {
    const slot = out[c.dayIndex]?.[c.meal]
    const at = slot?.dishes.findIndex((d) => d.kind === 'recipe' && !d.leftoverOf) ?? -1
    if (!slot || at < 0) continue
    const dishes = [...slot.dishes]
    dishes[at] = { ...(dishes[at] as RecipeDish), replaced: { recipeName: capitalise(c.dish), reason: 'restrictions' } }
    out[c.dayIndex][c.meal] = { ...slot, dishes }
  }
  return out
}

/** The note a «plato» type writes when no recipe of it fits («Pizza»): its name, nothing on the list. */
export function dishTypeNote(type: string): Dish {
  return { kind: 'note', text: dishTypeInfo(type)?.label ?? type, fixedDish: true }
}

/** `dish_type_missing_<type>_<meal>_d<day>` → the type, for the catalogue wishes. */
export function missingDishTypes(warnings: readonly string[]): string[] {
  const out = new Set<string>()
  for (const w of warnings) {
    const m = /^dish_type_missing_(.+)_(breakfast|lunch|snack|dinner)_d\d$/.exec(w)
    if (m) out.add(m[1])
  }
  return [...out]
}
