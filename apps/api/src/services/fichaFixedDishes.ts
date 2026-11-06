/**
 * PRO-1141 · Los platos fijos de la ficha entran en el menú su día.
 *
 * The ficha says «pizza el viernes por la noche» (`fixed_dish`, read by
 * `fichaMenuConstraints`). Before the generator fills the week, each of
 * those slots gets its dish:
 *
 * - a recipe whose name has the dish (`nameHasTerm`), the household's own
 *   recipes first, then the catalogue; it goes through the same allergy and
 *   diet check as any dish (`violatesRestrictions`). Dislikes, season, time
 *   and equipment don't apply: the household asked for it;
 * - no recipe matches → the dish's name as a note (Miguel 2026-11-05, A):
 *   nothing on the list. The name goes through the check too, as an
 *   ingredient («jamón con melón» in a vegetarian household is not written);
 * - every recipe that matches breaks an allergy or diet → nothing is put:
 *   the generator fills the slot and its dish says «En lugar de «Pizza»,
 *   que no encaja con vuestras alergias o dieta» (`replaced`, PRO-345).
 *
 * A «sin cocinar» day, a slot the week has off, a locked slot and a
 * plantilla «comida fija» (PRO-218, put last) keep winning. The dish carries
 * `fixedDish`: «Cambiar al azar» leaves it alone (routes/menus.ts).
 */
import type { DayMenu, DayTemplate, LockedSlots, Meal, NoteDish, RecipeDish } from '@ona/shared'
import { compileRestrictions, violatesRestrictions } from './dietaryRestrictions.js'
import { nameHasTerm, normalize } from './nutrition/allergens.js'
import type { RecipeWithCourse } from './matchableRecipes.js'
import type { FichaFixedDish } from './profile/reader.js'

export interface FixedDishSlot {
  dayIndex: number
  meal: Meal
  dish: RecipeDish | NoteDish
}

export interface FixedDishConflict {
  dayIndex: number
  meal: Meal
  /** The ficha's words («pizza»). */
  dish: string
}

const capitalise = (s: string) => {
  const t = s.trim()
  return t ? t[0].toLocaleUpperCase('es') + t.slice(1) : t
}

const LINK_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'con', 'y', 'a', 'al', 'en'])

/**
 * Pure: recipes whose name has every word of the dish (`nameHasTerm`: whole
 * words, plural-tolerant; «de», «con»… aside), the household's own first,
 * then the catalogue; audited-out catalogue recipes never.
 */
export function recipesForFixedDish<R extends Pick<RecipeWithCourse, 'name' | 'authorId' | 'catalogAuditIssues'>>(dish: string, recipes: readonly R[]): { household: R[]; catalogue: R[] } {
  const words = normalize(dish).split(/[^a-z0-9ñ]+/).filter((w) => w && !LINK_WORDS.has(w))
  const out = { household: [] as R[], catalogue: [] as R[] }
  if (words.length === 0) return out
  for (const r of recipes) {
    if (r.catalogAuditIssues?.length) continue
    const name = normalize(r.name)
    if (!words.every((w) => nameHasTerm(name, w))) continue
    ;(r.authorId ? out.household : out.catalogue).push(r)
  }
  return out
}

/**
 * Pure: what each of the ficha's fixed slots gets this week. A slot is taken
 * by the first fixed dish that names it; a recipe is not repeated across
 * fixed slots while another one fits.
 */
export function resolveFichaFixedDishes(
  fixed: readonly FichaFixedDish[],
  recipes: readonly RecipeWithCourse[],
  restrictions: readonly string[],
  opts: {
    template: DayTemplate[]
    skippedDays?: ReadonlySet<number>
    lockedSlots?: LockedSlots
    existingDays?: DayMenu[]
    bannedRecipeIds?: ReadonlySet<string>
    random?: () => number
  },
): { slots: FixedDishSlot[]; conflicts: FixedDishConflict[]; warnings: string[] } {
  const slots: FixedDishSlot[] = []
  const conflicts: FixedDishConflict[] = []
  const warnings: string[] = []
  if (fixed.length === 0) return { slots, conflicts, warnings }
  const rules = compileRestrictions(restrictions)
  const random = opts.random ?? Math.random
  const used = new Set<string>()
  const taken = new Set<string>()

  for (const f of fixed) {
    const { household, catalogue } = recipesForFixedDish(f.dish, recipes)
    const tiers = [household, catalogue].map((t) => t.filter((r) => !opts.bannedRecipeIds?.has(r.id)))
    const safeTiers = tiers.map((t) => t.filter((r) => !violatesRestrictions(r, rules)))
    for (const dayIndex of f.days) {
      const key = `${dayIndex}:${f.meal}`
      if (taken.has(key) || opts.skippedDays?.has(dayIndex) || !opts.template[dayIndex]?.[f.meal]) continue
      if (opts.lockedSlots?.[String(dayIndex)]?.[f.meal] && opts.existingDays?.[dayIndex]?.[f.meal]) continue
      taken.add(key)

      if (household.length + catalogue.length === 0) {
        // No recipe: the dish's name, nothing on the list — unless the name alone breaks a restriction.
        if (violatesRestrictions({ name: f.dish, ingredients: [{ ingredientName: f.dish }] }, rules)) {
          conflicts.push({ dayIndex, meal: f.meal, dish: f.dish })
          warnings.push(`fixed_dish_restricted_${f.meal}_d${dayIndex}`)
        } else {
          slots.push({ dayIndex, meal: f.meal, dish: { kind: 'note', text: capitalise(f.dish), fixedDish: true } })
        }
        continue
      }
      // Every match vetoed this week: the slot is generated as usual.
      if (tiers.every((t) => t.length === 0)) continue
      const safe = safeTiers.find((t) => t.length > 0)
      if (!safe) {
        conflicts.push({ dayIndex, meal: f.meal, dish: f.dish })
        warnings.push(`fixed_dish_restricted_${f.meal}_d${dayIndex}`)
        continue
      }
      const fresh = safe.filter((r) => !used.has(r.id))
      const pool = fresh.length ? fresh : safe
      const pick = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
      used.add(pick.id)
      slots.push({
        dayIndex,
        meal: f.meal,
        dish: { kind: 'recipe', recipeId: pick.id, recipeName: pick.name, course: pick.course ?? null, fixedDish: true },
      })
    }
  }
  return { slots, conflicts, warnings }
}

/** Pure: the template without the slots a fixed dish fills, so the generator never picks for them. */
export function templateWithoutFixedDishes(template: DayTemplate[], slots: readonly FixedDishSlot[]): DayTemplate[] {
  if (slots.length === 0) return template
  return template.map((day, i) => {
    const out: DayTemplate = { ...day }
    for (const s of slots) if (s.dayIndex === i) delete out[s.meal]
    return out
  })
}

/** Pure: the fixed slots counted as locked (a plantilla táper never overwrites one). */
export function lockedWithFixedDishes(locked: LockedSlots, slots: readonly FixedDishSlot[]): LockedSlots {
  if (slots.length === 0) return locked
  const out: LockedSlots = { ...locked }
  for (const s of slots) out[String(s.dayIndex)] = { ...(out[String(s.dayIndex)] ?? {}), [s.meal]: true }
  return out
}

/** Pure: put the fixed dishes into the week, with the plantilla's diners for the slot when set. */
export function withFichaFixedDishes(days: DayMenu[], slots: readonly FixedDishSlot[], mealDiners?: Record<Meal, number>[]): DayMenu[] {
  if (slots.length === 0) return days
  const out = days.map((d) => ({ ...(d ?? {}) }))
  for (const s of slots) {
    if (!out[s.dayIndex]) continue
    const diners = mealDiners?.[s.dayIndex]?.[s.meal]
    out[s.dayIndex][s.meal] = { ...(diners && diners > 0 ? { servings: diners } : {}), dishes: [{ ...s.dish }] }
  }
  return out
}

/** Pure: the generated dish of a slot whose fixed dish breaks a restriction says why (PRO-345's «En lugar de …»). */
export function markFixedDishConflicts(days: DayMenu[], conflicts: readonly FixedDishConflict[]): DayMenu[] {
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
