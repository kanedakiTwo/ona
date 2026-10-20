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
   * A bought mark (PRO-270): how much of `quantity` was for each week's
   * dishes, `{ <Monday>: amount }` in the key's unit. It covers only those
   * weeks: merluza bought for Saturday 17 doesn't tick the merluza of
   * Monday 26. Missing on bought marks saved before 2026-10-21: they count
   * as bought for the current week.
   */
  weeks?: Record<string, number>
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
  /** ISO `YYYY-MM-DD`: last day of the list it was set on. */
  until: string
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
  /**
   * `today` drops edits past their day and bought weeks already gone;
   * `rangeTo` (the list's last day) decides which edits apply (PRO-175).
   */
  range: { today?: string; rangeTo?: string } = {},
): { items: ShoppingItem[]; state: ItemStateMap } {
  const thisWeek = range.today ? mondayOfIso(range.today) : undefined
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
      const s = mergedStateFor(it, state, thisWeek)
      return s ? { ...it, checked: s.checked, inStock: s.inStock, pricePerUnit: s.pricePerUnit } : it
    }
    return applyState(it, state, fresh, convert, thisWeek)
  })
  const kept = [...state.entries()]
    .map(([k, s]) => [k, withoutPastWeeks(s, thisWeek)] as const)
    .filter(([, s]) => s.checked || s.inStock || s.pricePerUnit != null || s.edit)
  return { items, state: Object.fromEntries(kept.slice(-ITEM_STATE_MAX)) }
}

/** Monday (ISO `YYYY-MM-DD`) of the week of an ISO date. */
export function mondayOfIso(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

/** A bought mark forgets the weeks already gone; with none left, the mark goes. */
function withoutPastWeeks(s: ItemState, thisWeek: string | undefined): ItemState {
  if (!s.weeks || !thisWeek) return s
  const weeks = Object.fromEntries(Object.entries(s.weeks).filter(([w, q]) => w >= thisWeek && q > 0))
  if (Object.keys(weeks).length === Object.keys(s.weeks).length) return s
  if (Object.keys(weeks).length > 0) return { ...s, weeks, quantity: sum(weeks) }
  const { weeks: _gone, quantity: _q, ...rest } = s
  return { ...rest, checked: false }
}

const sum = (weeks: Record<string, number>) => Object.values(weeks).reduce((a, b) => a + b, 0)

/**
 * Ticking a line on or off (the check route and Mimo, PRO-270). On: what
 * this line asks is bought, for its weeks, on top of what was bought for
 * other weeks (ticked on «La que viene», then again on «Esta semana»). Off:
 * nothing of it is bought. Either way the partial «ya tienes» goes. Pure:
 * mutates and returns the row.
 */
export function toggleChecked(item: ShoppingItem): ShoppingItem {
  item.checked = !item.checked
  const prev = item.mark
  delete item.haveQuantity
  delete item.haveSource
  delete item.mark
  if (item.checked && !item.inStock && item.weeks && prev?.source === 'checked' && prev.weeks) {
    const weeks: Record<string, number> = { ...prev.weeks }
    for (const [w, q] of Object.entries(item.weeks)) weeks[w] = Math.max(weeks[w] ?? 0, q)
    item.mark = { source: 'checked', quantity: sum(weeks), weeks, covered: true }
  }
  return item
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
  if (edit.quantity != null && edit.quantity >= 0) out = { ...out, quantity: edit.quantity, menuQuantity: it.quantity }
  if (edit.skipped) out = { ...out, skipped: true }
  return out
}

/**
 * Write a change of the household on a menu line (PRO-175) into the row and
 * into the remembered state, so it survives the rebuild on the next GET.
 * `skipped: false` / `quantity: null` undo it. Pure: mutates the given row
 * and returns the new state map.
 */
export function editMenuLine(
  item: ShoppingItem,
  state: ItemStateMap | null | undefined,
  change: { skipped?: boolean; quantity?: number | null },
  until: string,
): ItemStateMap {
  const key = itemStateKey(item)
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
  if (change.quantity !== undefined) {
    const menuQty = item.menuQuantity ?? item.quantity
    if (change.quantity == null || Math.abs(change.quantity - menuQty) < 1e-9) {
      delete edit.quantity
      item.quantity = menuQty
      delete item.menuQuantity
    } else {
      edit.quantity = change.quantity
      item.menuQuantity = menuQty
      item.quantity = change.quantity
    }
    // The amount changed: the partial «ya tienes» no longer adds up.
    delete item.haveQuantity
    delete item.haveSource
  }
  const has = edit.skipped || edit.quantity != null
  const { edit: _old, ...rest } = prev
  if (has) next[key] = { ...rest, edit: { ...(edit.skipped ? { skipped: true } : {}), ...(edit.quantity != null ? { quantity: edit.quantity } : {}), until } }
  else if (rest.checked || rest.inStock || rest.pricePerUnit != null) next[key] = rest
  else delete next[key]
  return next
}

/** What a row of the previous list says: its marks and the amount they cover. */
function stateOfRow(it: ShoppingItem): ItemState {
  const pricePerUnit = it.pricePerUnit ?? null
  // A mark carried from memory stays whole until the household touches the
  // line (PRO-270): 15 eggs at home shown on a «Hoy» that asks for 2 are
  // still 15 when the next two weeks come back (Familia Ruiz, 2026-10-20).
  // Only while the row still shows that mark: a flag changed by a path that
  // doesn't know about `mark` (an old client, Mimo's «en casa») wins.
  const m = it.mark
  const carried =
    m &&
    (it.haveQuantity
      ? !it.checked && !it.inStock && it.haveSource === m.source
      : it.checked || it.inStock
        ? !!m.covered && (m.source === 'inStock' ? !!it.inStock : !!it.checked && !it.inStock)
        : !m.covered && m.source === 'checked' && !!m.weeks)
  if (m && carried) {
    return {
      checked: m.source === 'checked',
      inStock: m.source === 'inStock',
      pricePerUnit,
      quantity: m.quantity,
      ...(m.source === 'checked' && m.weeks ? { weeks: m.weeks } : {}),
    }
  }
  if (it.checked || it.inStock) {
    const weeks = it.checked && !it.inStock && it.weeks ? { weeks: it.weeks } : {}
    return { checked: !!it.checked, inStock: !!it.inStock, pricePerUnit, quantity: it.quantity, ...weeks }
  }
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
function applyState(
  it: ShoppingItem,
  state: Map<string, ItemState>,
  fresh: Set<string>,
  convert?: ConvertQty,
  thisWeek?: string,
): ShoppingItem {
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
  const conv = (q: number) => (unit === it.unit ? q : (convert?.(id, q, unit!, it.unit) ?? null))
  const total = conv(s.quantity)
  if (total == null) return base // can't compare: stays marked
  // A bought mark covers the weeks it was bought for (PRO-270, Familia Ruiz
  // 2026-10-19: merluza bought for Saturday 17 ticked the merluza of Monday
  // 26). «En casa» is what's in the pantry: it covers any week.
  const byWeek = !s.inStock && it.weeks && (s.weeks || thisWeek)
  let have = total
  let weeks: Record<string, number> | undefined
  if (byWeek) {
    weeks = {}
    for (const [w, q] of Object.entries(s.weeks ?? { [thisWeek!]: s.quantity })) {
      const c = conv(q)
      if (c != null && c > 0) weeks[w] = c
    }
    have = Object.entries(it.weeks!).reduce((acc, [w, need]) => acc + Math.min(weeks![w] ?? 0, need), 0)
  }
  const mark: ShoppingItem['mark'] = { source: s.inStock ? 'inStock' : 'checked', quantity: total, ...(weeks ? { weeks } : {}) }
  const missing = roundMissing(it.quantity - have, it.unit)
  if (missing <= 0) return { ...base, mark: { ...mark, covered: true } }
  const covered = it.quantity - missing
  return {
    ...it,
    checked: false,
    inStock: false,
    pricePerUnit,
    ...(covered > 0 ? { haveQuantity: covered, haveSource: s.inStock ? ('inStock' as const) : ('checked' as const) } : {}),
    mark,
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
  delete item.mark
  item.checked = false
  if (!(have > 0)) {
    item.inStock = false
    return item
  }
  const missing = roundMissing(item.quantity - have, item.unit)
  if (missing <= 0) {
    item.inStock = true
    // «Tengo una docena» on a line of 4: the 12 are remembered (PRO-270).
    if (have > item.quantity) item.mark = { source: 'inStock', quantity: have, covered: true }
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
function mergedStateFor(it: ShoppingItem, state: Map<string, ItemState>, thisWeek?: string): ItemState | undefined {
  const merged = it.mergedIngredientIds ?? []
  const found: ItemState[] = []
  // A price is € per unit: only one remembered in this line's unit applies.
  const priced: ItemState[] = []
  // A bought mark only counts for the weeks it was bought for (PRO-270).
  const otherWeeks = (s: ItemState) => {
    if (s.inStock || !s.checked || !it.weeks) return false
    const weeks = s.weeks ? Object.keys(s.weeks) : thisWeek ? [thisWeek] : null
    return weeks != null && !weeks.some((w) => (it.weeks![w] ?? 0) > 0)
  }
  for (const id of [it.ingredientId, ...merged]) {
    const raw = state.get(`${id}|${it.unit}`)
    const same = raw && otherWeeks(raw) ? { ...raw, checked: false } : raw
    if (same) {
      found.push(same)
      priced.push(same)
      continue
    }
    const other = UNITS.map((u) => state.get(`${id}|${u}`)).find(Boolean)
    if (other) found.push(otherWeeks(other) ? { ...other, checked: false } : other)
  }
  if (found.length === 0) return undefined
  return {
    checked: found.some((s) => s.checked),
    inStock: found.some((s) => s.inStock),
    pricePerUnit: priced.find((s) => s.pricePerUnit != null)?.pricePerUnit ?? null,
  }
}
