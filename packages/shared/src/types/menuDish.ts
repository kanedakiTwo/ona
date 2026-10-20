import type { Course } from './recipe.js'

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
   * | `fridge` («Táper de la nevera», PRO-240: the same, kept in the fridge).
   */
  variant?: 'planned' | 'leftover' | 'freezer' | 'fridge'
  /** Back-reference when `variant === 'leftover'`. Carries the dish position because a slot can have multiple recipes now. */
  leftoverOf?: { day: number; meal: string; dishPosition: number } | null
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
 * A táper already cooked (PRO-82 freezer, PRO-240 fridge): linked to its
 * recipe, never adds to the shopping list, nothing to cook.
 */
export function isTaperDish(d: Dish | null | undefined): boolean {
  return !!d && d.kind === 'recipe' && (d.variant === 'freezer' || d.variant === 'fridge')
}

/** Returns only the recipe dishes, in their original order. */
export function recipeDishesOf(dishes: Dish[]): RecipeDish[] {
  return dishes.filter(isRecipeDish)
}
