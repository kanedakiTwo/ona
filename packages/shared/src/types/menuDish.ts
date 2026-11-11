import { dishTypeInfo } from '../constants/dishTypes.js'
import type { Course } from './recipe.js'

/**
 * «Semana tipo» (D-182 §6, PRO-1186): the dish answers to a dish type the
 * week type asks for in that meal (`type`, a `DISH_TYPES` key). `missing`:
 * no recipe of that type fitted — a «plato» type is written by its name
 * (a note), a broad one got any recipe. Set by the generator, «Que elija
 * Mimoia» on that meal and «Guardar en mi semana tipo»; gone as soon as the
 * dish is changed by hand. The day card shows it as a chip.
 */
export interface FromWeekType {
  type: string
  missing?: boolean
}

/**
 * Why a dish was replaced on its own: see `RecipeDish.replaced`. `diet` and
 * `removed`: the recipe changed or was deleted (PRO-345); `restrictions`:
 * someone in the household saved an allergy or diet it breaks (PRO-364,
 * PRO-1067).
 */
export type DishReplacedReason = 'diet' | 'removed' | 'restrictions'

/** Pure: the day card's line for a replaced dish (PRO-345, PRO-1067). */
export function replacedDishLine(r: { recipeName: string; reason: DishReplacedReason }): string {
  if (r.reason === 'restrictions') return `En lugar de «${r.recipeName}», que no encaja con vuestras alergias o dieta`
  return r.reason === 'diet'
    ? `En lugar de «${r.recipeName}», que ha cambiado y ya no encaja con vuestra dieta`
    : `En lugar de «${r.recipeName}», que ya no está en el catálogo`
}

export interface RecipeDish {
  kind: 'recipe'
  recipeId: string
  recipeName?: string
  /** Hydrated from `recipes.course` on read; nullable for versatile recipes. */
  course?: Course | null
  /**
   * `planned` (default) | `leftover` (cloned from a previous slot's recipe-dish)
   * | `freezer` (a táper from the freezer, PRO-82: linked to its recipe, never
   * adds to the shopping list, whatever week it was cooked in)
   * | `fridge` («Táper de la nevera», PRO-240: the same, kept in the fridge)
   * | `cooked` («Sobras de otro día», 2026-10-20: a dish already in the menu
   * that the household already has cooked — fridge, freezer or anywhere —
   * set from its «···»; the same as the other tápers).
   */
  variant?: 'planned' | 'leftover' | 'freezer' | 'fridge' | 'cooked'
  /** Back-reference when `variant === 'leftover'`. Carries the dish position because a slot can have multiple recipes now. */
  leftoverOf?: { day: number; meal: string; dishPosition: number } | null
  /**
   * PRO-259: the line of why Mimo chose this dish («lentejas porque os
   * gustan los guisos…»). Only set when the menu comes from the planner
   * (menú inteligente, specs/smart-menu.md); today's generator never sets it.
   */
  why?: string | null
  /**
   * PRO-345: Mimoia put this dish in place of another because that recipe
   * changed after entering the menu and no longer fits the household's
   * allergies or diet (`diet`), or was deleted (`removed`); PRO-1067: or
   * because someone saved an allergy or diet the old dish breaks
   * (`restrictions`, PRO-364's review). The day card says so. Gone as soon
   * as the dish is changed by hand.
   */
  replaced?: { recipeName: string; reason: DishReplacedReason } | null
  /**
   * PRO-364: someone in the household saved an allergy or diet this dish
   * breaks, and there was no other recipe to put instead (or it's a táper
   * already cooked). The day's card warns; any change of the dish drops it.
   */
  restrictionConflict?: boolean
  /**
   * A concrete recipe of the household's «semana tipo» (D-182; before, a
   * «plato fijo» of the ficha, PRO-1141), put there by the generator.
   * «Generar» puts it back; «Cambiar al azar» picks another one.
   */
  fixedDish?: boolean
  /** The week type's dish type this dish answers to (PRO-1186). */
  fromWeekType?: FromWeekType | null
  /** Hydrated from `recipes.dish_types` on every menu response («Guardar en mi semana tipo» offers them); NOT persisted. */
  dishTypes?: string[] | null
  /** Hydrated from `recipes.image_url` on every menu response; NOT persisted in JSONB. */
  imageUrl?: string | null
  /** Hydrated alongside `imageUrl`. */
  prepTime?: number | null
  totalTime?: number | null
}

export interface NoteDish {
  kind: 'note'
  /** Free-text dish. Max 120 chars enforced at the API. */
  text: string
  /**
   * PRO-218: a «comida fija» placed by the generator («Fijo: yogur con
   * cereales»). Its items (per person) go to the shopping list, scaled by the
   * slot's diners. Absent on ordinary notes, which add nothing to the list.
   */
  fixed?: { items: Array<{ name: string; quantity: number; unit: 'u' | 'g' | 'ml' }> }
  /** A dish of the «semana tipo» with no recipe that fits (a type like «Pizza»): its name, nothing on the list. */
  fixedDish?: boolean
  /** The week type's dish type this note stands for when no recipe of it fitted (PRO-1186). */
  fromWeekType?: FromWeekType | null
}

/** Pure (PRO-1141, D-182): the dish was put by the «semana tipo» as a fixed one (not a táper copied from it). */
export function isFixedDish(d: Dish | null | undefined): boolean {
  return !!d && d.fixedDish === true && !(d.kind === 'recipe' && d.leftoverOf)
}

export type Dish = RecipeDish | NoteDish

/**
 * Pure (PRO-1186): the chip of a meal that comes from the week type —
 * «Legumbres · semana tipo»; «Semana tipo» for a concrete recipe or a dish
 * written there; and, when no recipe of the type fitted, a warning
 * (`missing`). Null for a meal the week type left free, a táper copied from
 * another meal, or a «Fijo: …» (its text already says so).
 */
export function weekTypeChipOf(dishes: readonly Dish[] | null | undefined): { label: string; missing: boolean; type: string | null } | null {
  const list = (dishes ?? []).filter((d) => !(d.kind === 'recipe' && (d.leftoverOf || isTaperVariant(d.variant))))
  const typed = list.find((d) => d.fromWeekType?.type)
  if (typed?.fromWeekType) {
    const label = dishTypeInfo(typed.fromWeekType.type)?.label ?? typed.fromWeekType.type
    const type = typed.fromWeekType.type
    if (!typed.fromWeekType.missing) return { label: `${label} · semana tipo`, missing: false, type }
    return {
      label: typed.kind === 'note' ? `Ninguna receta de «${label}» encaja: lo dejo escrito` : `Ninguna receta de «${label}» encaja: he puesto otra`,
      missing: true,
      type,
    }
  }
  if (list.some((d) => isFixedDish(d) && !(d.kind === 'note' && d.fixed))) return { label: 'Semana tipo', missing: false, type: null }
  return null
}

export function isRecipeDish(d: Dish): d is RecipeDish {
  return d.kind === 'recipe'
}

export function isNoteDish(d: Dish): d is NoteDish {
  return d.kind === 'note'
}

/**
 * A táper already cooked (PRO-82 freezer, PRO-240 fridge, «sobras de otro
 * día»): linked to its recipe, never adds to the shopping list, nothing to cook.
 */
export function isTaperDish(d: Dish | null | undefined): boolean {
  return !!d && d.kind === 'recipe' && isTaperVariant(d.variant)
}

/** The same test on a bare variant, for loosely typed dishes. */
export function isTaperVariant(variant: string | null | undefined): boolean {
  return variant === 'freezer' || variant === 'fridge' || variant === 'cooked'
}

/** Returns only the recipe dishes, in their original order. */
export function recipeDishesOf(dishes: Dish[]): RecipeDish[] {
  return dishes.filter(isRecipeDish)
}
