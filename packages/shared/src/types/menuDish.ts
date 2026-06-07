import type { Course } from './recipe.js'

export interface RecipeDish {
  kind: 'recipe'
  recipeId: string
  recipeName?: string
  /** Hydrated from `recipes.course` on read; nullable for versatile recipes. */
  course?: Course | null
  /** Per-dish meal-type pin (cremas, legumbres…). Moved from slot in the multi-dish migration. */
  pinnedType?: string | null
  /** `planned` (default) | `leftover` (cloned from a previous slot's recipe-dish). */
  variant?: 'planned' | 'leftover'
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
}

export type Dish = RecipeDish | NoteDish

export function isRecipeDish(d: Dish): d is RecipeDish {
  return d.kind === 'recipe'
}

export function isNoteDish(d: Dish): d is NoteDish {
  return d.kind === 'note'
}

/** Returns only the recipe dishes, in their original order. */
export function recipeDishesOf(dishes: Dish[]): RecipeDish[] {
  return dishes.filter(isRecipeDish)
}
