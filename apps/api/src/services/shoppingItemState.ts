import type { BuyableUnit, ShoppingItem } from '@ona/shared'

/**
 * What the user has said about a product of their shopping list, remembered
 * across rebuilds: bought, at home, price, and how much was marked. Stored
 * under `(ingredientId|unit)` (the line it was marked on), but looked up by
 * ingredient (PRO-199): a menu change that moves «Ajo · 8 u» to «Ajo · 25 g»
 * keeps it bought — before, the new unit missed the key and the garlic came
 * back pending.
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
  /**
   * Amount marked bought / at home, in the key's unit (PRO-199). Missing on
   * state saved before 2026-10-19: such a mark covers any new amount.
   */
  quantity?: number
}
export type ItemStateMap = Record<string, ItemState>

/** Cap on remembered products, oldest first out (insertion order). */
export const ITEM_STATE_MAX = 400

export const itemStateKey = (it: Pick<ShoppingItem, 'ingredientId' | 'unit'>) => `${it.ingredientId}|${it.unit}`

/** Converts an amount of one ingredient between buyable units; null when there is no known conversion. */
export type ConvertQty = (ingredientId: string, quantity: number, from: BuyableUnit, to: BuyableUnit) => number | null

/**
 * Merge the previous rebuild (its rows + its remembered state) into the fresh
 * menu-derived rows. Rows of the previous list win over the older memory
 * (they are the latest the user saw). Returns the rows to store and the state
 * to remember; entries with nothing to remember are dropped.
 *
 * What was marked follows the ingredient, whatever unit the new line has
 * (PRO-199, Miguel 2026-10-18): when the new menu asks for more than what was
 * marked and the amounts compare (same unit or `convert`), the line goes back
 * to pending with `haveQuantity` set so the list says «Te faltan X»;
 * otherwise it stays marked.
 */
export function carryItemState(
  menuItems: ShoppingItem[],
  prevItems: ShoppingItem[],
  prevState: ItemStateMap | null | undefined,
  convert?: ConvertQty,
): { items: ShoppingItem[]; state: ItemStateMap } {
  const state = new Map<string, ItemState>(Object.entries(prevState ?? {}))
  // Keys written from the previous rows: the latest the user saw.
  const fresh = new Set<string>()
  for (const it of prevItems) {
    if (it.kind === 'manual' || !it.ingredientId) continue
    const key = itemStateKey(it)
    state.delete(key) // re-insert: most recent last
    state.set(key, stateOfRow(it))
    fresh.add(key)
  }
  const items = menuItems.map((it) => {
    if (!it.ingredientId) return it
    if ((it.mergedIngredientIds ?? []).length > 0) {
      const s = mergedStateFor(it, state)
      return s ? { ...it, checked: s.checked, inStock: s.inStock, pricePerUnit: s.pricePerUnit } : it
    }
    return applyState(it, state, fresh, convert)
  })
  const kept = [...state.entries()].filter(([, s]) => s.checked || s.inStock || s.pricePerUnit != null)
  return { items, state: Object.fromEntries(kept.slice(-ITEM_STATE_MAX)) }
}

const UNITS: ShoppingItem['unit'][] = ['g', 'ml', 'u', 'cda', 'cdita']

/** What a row of the previous list says: its marks and the amount they cover. */
function stateOfRow(it: ShoppingItem): ItemState {
  const pricePerUnit = it.pricePerUnit ?? null
  if (it.checked || it.inStock) return { checked: !!it.checked, inStock: !!it.inStock, pricePerUnit, quantity: it.quantity }
  // A line left pending for the rest still remembers what the household had.
  if (it.haveQuantity && it.haveQuantity > 0 && it.haveSource) {
    return { checked: it.haveSource === 'checked', inStock: it.haveSource === 'inStock', pricePerUnit, quantity: it.haveQuantity }
  }
  return { checked: false, inStock: false, pricePerUnit }
}

/**
 * State for a fresh one-ingredient row, looked up by ingredient: the entry
 * in the row's own unit if there is one, else the latest marked entry of the
 * same ingredient in another unit. Entries from the previous rows win over
 * the older memory.
 */
function applyState(it: ShoppingItem, state: Map<string, ItemState>, fresh: Set<string>, convert?: ConvertQty): ShoppingItem {
  const id = it.ingredientId!
  const keyOf = (u: BuyableUnit) => `${id}|${u}`
  const inFresh = UNITS.some((u) => fresh.has(keyOf(u)))
  const pool = UNITS.filter((u) => state.has(keyOf(u)) && (!inFresh || fresh.has(keyOf(u))))
  if (pool.length === 0) return it
  let unit: BuyableUnit | undefined = pool.includes(it.unit) ? it.unit : undefined
  if (!unit) {
    // Latest marked entry in another unit (insertion order = recency).
    const marked = [...state.keys()].reverse().find((k) => {
      const [kid, ku] = splitKey(k)
      const s = state.get(k)!
      return kid === id && pool.includes(ku as BuyableUnit) && (s.checked || s.inStock)
    })
    if (!marked) return it
    unit = splitKey(marked)[1] as BuyableUnit
  }
  const s = state.get(keyOf(unit))!
  // A price is € per unit: only one remembered in this line's unit applies.
  const pricePerUnit = unit === it.unit ? s.pricePerUnit : (it.pricePerUnit ?? null)
  const base = { ...it, checked: s.checked, inStock: s.inStock, pricePerUnit }
  if (!(s.checked || s.inStock) || s.quantity == null) return base
  const have = unit === it.unit ? s.quantity : (convert?.(id, s.quantity, unit, it.unit) ?? null)
  if (have == null) return base // can't compare: stays marked
  const missing = roundMissing(it.quantity - have, it.unit)
  if (missing <= 0) return base
  return {
    ...it,
    checked: false,
    inStock: false,
    pricePerUnit,
    haveQuantity: it.quantity - missing,
    haveSource: s.inStock ? 'inStock' : 'checked',
  }
}

/** What is left to buy, in amounts a shop sells; 0 when the gap is rounding noise (≤ 2 %). */
function roundMissing(missing: number, unit: BuyableUnit): number {
  if (!(missing > 0)) return 0
  if (unit === 'u') return Math.ceil(missing - 0.1)
  if (unit === 'g' || unit === 'ml') return missing < 5 ? 0 : Math.round(missing)
  return Math.round(missing * 2) / 2 // cda / cdita: half spoons
}

function splitKey(key: string): [string, string] {
  const i = key.lastIndexOf('|')
  return [key.slice(0, i), key.slice(i + 1)]
}

/**
 * State for a row that joined several catalogue ingredients (PRO-177): it
 * gathers the state of every joined one (same unit, else any unit): marked
 * on any old line → marked on the joined line («huevos 6 u» ticked before the
 * join keeps «huevos 10 u» ticked); the price comes from the first one in the
 * same unit that has it.
 */
function mergedStateFor(it: ShoppingItem, state: Map<string, ItemState>): ItemState | undefined {
  const merged = it.mergedIngredientIds ?? []
  const found: ItemState[] = []
  // A price is € per unit: only one remembered in this line's unit applies.
  const priced: ItemState[] = []
  for (const id of [it.ingredientId, ...merged]) {
    const same = state.get(`${id}|${it.unit}`)
    if (same) {
      found.push(same)
      priced.push(same)
      continue
    }
    const other = UNITS.map((u) => state.get(`${id}|${u}`)).find(Boolean)
    if (other) found.push(other)
  }
  if (found.length === 0) return undefined
  return {
    checked: found.some((s) => s.checked),
    inStock: found.some((s) => s.inStock),
    pricePerUnit: priced.find((s) => s.pricePerUnit != null)?.pricePerUnit ?? null,
  }
}
