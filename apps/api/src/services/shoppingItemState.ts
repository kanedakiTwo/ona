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
  /**
   * What the household changed on a menu line (PRO-175): «No lo compro esta
   * semana» (`skipped`) and / or their own amount (`quantity`, in the key's
   * unit). It applies to lists that end on or before `until` (the end of the
   * list it was set on) and is forgotten after that day. Written by the edit
   * route, never derived from the rows.
   */
  edit?: LineEdit
}
export interface LineEdit {
  skipped?: boolean
  quantity?: number
  /**
   * The unit the household buys it in when it isn't the menu's (PRO-292):
   * `quantity` is then in this unit. Stored under the menu's key.
   */
  unit?: BuyableUnit
  /** ISO `YYYY-MM-DD`: last day of the list it was set on. */
  until: string
}
export type ItemStateMap = Record<string, ItemState>

/** Cap on remembered products, oldest first out (insertion order). */
export const ITEM_STATE_MAX = 400

export const itemStateKey = (it: Pick<ShoppingItem, 'ingredientId' | 'unit'>) => `${it.ingredientId}|${it.unit}`

/** Key of a menu line's edit: the unit the menu asked in, even after the household switched it (PRO-292). */
export const menuLineKey = (it: Pick<ShoppingItem, 'ingredientId' | 'unit' | 'menuUnit'>) => `${it.ingredientId}|${it.menuUnit ?? it.unit}`

/** A line can't be switched to that unit: the ingredient has no density / unit weight for it (PRO-292). */
export class UnitChangeError extends Error {
  constructor(public unit: BuyableUnit) {
    super(`No se puede pasar a ${unit}`)
    this.name = 'UnitChangeError'
  }
}

/**
 * An amount converted to another unit, rounded up to what a shop sells
 * (whole units, 25 / 50 / 100 g steps, half spoons): 700 g of onion at
 * 150 g each → 5 u, never 4,7.
 */
export function roundUpForUnit(q: number, unit: BuyableUnit): number {
  if (!(q > 0)) return 0
  if (unit === 'u') return Math.max(1, Math.ceil(q - 0.05))
  if (unit === 'g' || unit === 'ml') {
    const step = q < 250 ? 25 : q < 1000 ? 50 : 100
    return Math.ceil(q / step - 1e-9) * step
  }
  return Math.max(0.5, Math.ceil(q * 2 - 1e-9) / 2)
}

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
  /** `today` drops edits past their day; `rangeTo` (the list's last day) decides which apply (PRO-175). */
  range: { today?: string; rangeTo?: string } = {},
): { items: ShoppingItem[]; state: ItemStateMap } {
  const state = new Map<string, ItemState>(Object.entries(prevState ?? {}))
  for (const [k, s] of state) {
    if (s.edit && range.today && s.edit.until < range.today) {
      const { edit: _gone, ...rest } = s
      state.set(k, rest)
    }
  }
  // Keys written from the previous rows: the latest the user saw.
  const fresh = new Set<string>()
  for (const it of prevItems) {
    if (it.kind === 'manual' || !it.ingredientId) continue
    const key = itemStateKey(it)
    const edit = state.get(key)?.edit
    state.delete(key) // re-insert: most recent last
    state.set(key, edit ? { ...stateOfRow(it), edit } : stateOfRow(it))
    fresh.add(key)
  }
  const items = menuItems.map((raw) => {
    if (!raw.ingredientId) return raw
    const it = applyEdit(raw, state.get(itemStateKey(raw))?.edit, range.rangeTo)
    // A joined line (PRO-177) marked on itself keeps its amount like any other
    // («nos quedan 4 huevos», PRO-182); otherwise it gathers its parts' marks.
    const own = fresh.has(itemStateKey(it)) ? state.get(itemStateKey(it)) : undefined
    if ((it.mergedIngredientIds ?? []).length > 0 && !(own && (own.checked || own.inStock))) {
      const s = mergedStateFor(it, state)
      return s ? { ...it, checked: s.checked, inStock: s.inStock, pricePerUnit: s.pricePerUnit } : it
    }
    return applyState(it, state, fresh, convert)
  })
  const kept = [...state.entries()].filter(([, s]) => s.checked || s.inStock || s.pricePerUnit != null || s.edit)
  return { items, state: Object.fromEntries(kept.slice(-ITEM_STATE_MAX)) }
}

const UNITS: ShoppingItem['unit'][] = ['g', 'ml', 'u', 'cda', 'cdita']

/**
 * The household's change on a menu line (PRO-175), when it applies to a list
 * ending on `rangeTo`: a list that reaches past the day it was set for (the
 * next weeks) shows the line as the menu asks; coming back shows it changed.
 */
export function applyEdit(it: ShoppingItem, edit: LineEdit | undefined, rangeTo: string | undefined): ShoppingItem {
  if (!edit || (rangeTo && rangeTo > edit.until)) return it
  let out = it
  if (edit.quantity != null && edit.quantity >= 0) {
    // In another unit (PRO-292): the row now reads in the household's unit.
    if (edit.unit && edit.unit !== it.unit) out = { ...out, quantity: edit.quantity, unit: edit.unit, menuQuantity: it.quantity, menuUnit: it.unit }
    else out = { ...out, quantity: edit.quantity, menuQuantity: it.quantity }
  }
  if (edit.skipped) out = { ...out, skipped: true }
  return out
}

/**
 * Write a change of the household on a menu line (PRO-175) into the row and
 * into the remembered state, so it survives the rebuild on the next GET.
 * `skipped: false` / `quantity: null` undo it. Pure: mutates the given row
 * and returns the new state map.
 *
 * `unit` (PRO-292) switches the line to another unit: without `quantity`
 * the amount on screen is converted (`convert`, rounded up to what a shop
 * sells); with it, `quantity` is in that unit. Going back to the menu's unit
 * without `quantity` goes back to the menu's amount. The edit stays under
 * the menu's key; bought / «en casa» stay on the row and follow its unit on
 * the next rebuild. Throws `UnitChangeError` when the ingredient can't be
 * converted to that unit.
 */
export function editMenuLine(
  item: ShoppingItem,
  state: ItemStateMap | null | undefined,
  change: { skipped?: boolean; quantity?: number | null; unit?: BuyableUnit },
  until: string,
  convert?: ConvertQty,
): ItemStateMap {
  const key = menuLineKey(item)
  const next: ItemStateMap = { ...(state ?? {}) }
  const prev = next[key] ?? { checked: !!item.checked, inStock: !!item.inStock, pricePerUnit: item.pricePerUnit ?? null }
  const edit: Partial<LineEdit> = { ...(prev.edit ?? {}) }
  if (change.skipped !== undefined) {
    if (change.skipped) {
      edit.skipped = true
      item.skipped = true
    } else {
      delete edit.skipped
      delete item.skipped
    }
  }
  if (change.quantity !== undefined || change.unit !== undefined) {
    const menuUnit = item.menuUnit ?? item.unit
    const menuQty = item.menuQuantity ?? item.quantity
    const target = change.unit ?? item.unit
    const before = { quantity: item.quantity, unit: item.unit }
    if (target === menuUnit) {
      // Back in the menu's unit: «g» alone goes back to the menu's amount.
      const q = change.quantity === undefined ? null : change.quantity
      delete edit.unit
      delete item.menuUnit
      item.unit = menuUnit
      if (q == null || Math.abs(q - menuQty) < 1e-9) {
        delete edit.quantity
        item.quantity = menuQty
        delete item.menuQuantity
      } else {
        edit.quantity = q
        item.menuQuantity = menuQty
        item.quantity = q
      }
    } else {
      const id = item.ingredientId ?? ''
      if (convert?.(id, 1, menuUnit, target) == null) throw new UnitChangeError(target)
      let q = change.quantity ?? null
      if (q == null) {
        const c = convert!(id, item.quantity, item.unit, target)
        if (c == null) throw new UnitChangeError(target)
        q = roundUpForUnit(c, target)
      }
      edit.unit = target
      edit.quantity = q
      item.unit = target
      item.quantity = q
      item.menuUnit = menuUnit
      item.menuQuantity = menuQty
    }
    // A price is € per unit: in another unit, keep what the line costs.
    if (item.unit !== before.unit && item.pricePerUnit != null) {
      item.pricePerUnit = item.quantity > 0 ? (item.pricePerUnit * before.quantity) / item.quantity : null
    }
    // The amount changed: the partial «ya tienes» no longer adds up.
    delete item.haveQuantity
    delete item.haveSource
  }
  const has = edit.skipped || edit.quantity != null
  const { edit: _old, ...rest } = prev
  if (has)
    next[key] = {
      ...rest,
      edit: {
        ...(edit.skipped ? { skipped: true } : {}),
        ...(edit.quantity != null ? { quantity: edit.quantity } : {}),
        ...(edit.quantity != null && edit.unit ? { unit: edit.unit } : {}),
        until,
      },
    }
  else if (rest.checked || rest.inStock || rest.pricePerUnit != null) next[key] = rest
  else delete next[key]
  return next
}

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

/**
 * «Nos queda una cebolla» (PRO-182): how much of a menu line the household
 * has at home, in the line's unit. The line stays pending for the rest
 * («Te faltan 6 · ya tienes 1»), the same partial state a menu change leaves
 * (PRO-199), so the next rebuild carries it and subtracts it from whatever
 * the menu asks then. 0 clears it; as much as the line (or more) marks the
 * whole line «en casa». Pure: mutates and returns the row.
 */
export function setHaveAtHome(item: ShoppingItem, have: number): ShoppingItem {
  delete item.haveQuantity
  delete item.haveSource
  item.checked = false
  if (!(have > 0)) {
    item.inStock = false
    return item
  }
  const missing = roundMissing(item.quantity - have, item.unit)
  if (missing <= 0) {
    item.inStock = true
    return item
  }
  item.inStock = false
  const covered = item.quantity - missing
  if (covered > 0) {
    item.haveQuantity = covered
    item.haveSource = 'inStock'
  }
  return item
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
