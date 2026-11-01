import type { Course } from './recipe.js'

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
  /** Per-dish meal-type pin (cremas, legumbres…). Moved from slot in the multi-dish migration. */
  pinnedType?: string | null
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
}

export type Dish = RecipeDish | NoteDish

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
