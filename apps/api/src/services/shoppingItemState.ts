import type { ShoppingItem } from '@ona/shared'

/**
 * What the user has said about a product of their shopping list, remembered
 * across rebuilds: bought, at home, price. Keyed by `(ingredientId|unit)`,
 * like the overlay merge.
 *
 * The rolling list is rebuilt for the date range on screen and only keeps
 * one row per user, so before 2026-10-10 a product absent from the range
 * being viewed lost its state: mark the onions "en casa", look at next week
 * (no onions), come back → unmarked. `item_state` keeps it.
 */
export interface ItemState {
  checked: boolean
  inStock: boolean
  pricePerUnit: number | null
}
export type ItemStateMap = Record<string, ItemState>

/** Cap on remembered products, oldest first out (insertion order). */
export const ITEM_STATE_MAX = 400

export const itemStateKey = (it: Pick<ShoppingItem, 'ingredientId' | 'unit'>) => `${it.ingredientId}|${it.unit}`

/**
 * Merge the previous rebuild (its rows + its remembered state) into the fresh
 * menu-derived rows. Rows of the previous list win over the older memory
 * (they are the latest the user saw). Returns the rows to store and the state
 * to remember; entries with nothing to remember are dropped.
 */
export function carryItemState(
  menuItems: ShoppingItem[],
  prevItems: ShoppingItem[],
  prevState: ItemStateMap | null | undefined,
): { items: ShoppingItem[]; state: ItemStateMap } {
  const state = new Map<string, ItemState>(Object.entries(prevState ?? {}))
  for (const it of prevItems) {
    if (it.kind === 'manual' || !it.ingredientId) continue
    const key = itemStateKey(it)
    state.delete(key) // re-insert: most recent last
    state.set(key, { checked: !!it.checked, inStock: !!it.inStock, pricePerUnit: it.pricePerUnit ?? null })
  }
  const items = menuItems.map((it) => {
    const s = it.ingredientId ? state.get(itemStateKey(it)) : undefined
    return s ? { ...it, checked: s.checked, inStock: s.inStock, pricePerUnit: s.pricePerUnit } : it
  })
  const kept = [...state.entries()].filter(([, s]) => s.checked || s.inStock || s.pricePerUnit != null)
  return { items, state: Object.fromEntries(kept.slice(-ITEM_STATE_MAX)) }
}
