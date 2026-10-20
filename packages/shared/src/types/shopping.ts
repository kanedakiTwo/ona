import type { Aisle } from '../constants/enums.js'

/** Subset of UNITS that are buyable (i.e. show up in shopping lists). */
export type BuyableUnit = 'g' | 'ml' | 'u' | 'cda' | 'cdita'

export interface ShoppingItem {
  id: string
  /**
   * Links back to the global ingredient catalog (drives aisle + conversions).
   * `null` for manual free-text items the user added themselves (PR 10).
   */
  ingredientId: string | null
  name: string
  quantity: number
  unit: BuyableUnit
  aisle: Aisle
  checked: boolean
  inStock: boolean
  /**
   * Provenance (PR 10).
   *   - 'menu' (default) — auto-aggregated from the source menu's recipes.
   *   - 'manual' — typed in by the user. Deletable; survives regenerate.
   *   - 'staple' — auto-included from `household_staples` (planned). Survives regenerate.
   * Older rows that predate this field are treated as 'menu'.
   */
  kind?: 'menu' | 'manual' | 'staple'
  /**
   * € per `unit` — what the user paid (or expects to pay). Optional. When
   * present, the list total adds `quantity * pricePerUnit`.
   */
  pricePerUnit?: number | null
  /** Recipe notes for this ingredient ("picada", "morada en juliana") — the shop order uses them. */
  notes?: string[]
  /** Manual items: 'default' when the user typed no amount (stored as 1 u). */
  quantitySource?: 'user' | 'default'
  /**
   * Menu items: other catalogue ingredients joined into this line because
   * they are the same product («huevos» + «yema de huevo», PRO-177). What was
   * marked on any of them carries over to this line.
   */
  mergedIngredientIds?: string[]
  /**
   * Menu items: part of `quantity` the household already has — bought or at
   * home for an earlier version of the menu (PRO-199). The line stays pending
   * for the rest («Te faltan 10 g»). Set only when the menu now asks for more
   * than what was marked and both amounts can be compared (same unit or a
   * known conversion). Ticking or un-ticking the line clears it.
   */
  haveQuantity?: number
  /** What `haveQuantity` came from: marked bought or marked at home. */
  haveSource?: 'checked' | 'inStock'
  /**
   * Menu items: the household won't buy it for this list («No lo compro esta
   * semana», PRO-175). The line stays (so it can be put back) but counts as
   * nothing: not to buy, not in the total, not in shop orders.
   */
  skipped?: boolean
  /**
   * Menu items: what the menu asked for when the household changed the
   * amount (PRO-175); `quantity` is then their amount.
   */
  menuQuantity?: number
  /**
   * Menu items: the unit the menu asked in, when the household switched the
   * line to another one (PRO-292: «Cebolla · 700 g» → «3 u»). `unit` and
   * `quantity` are then theirs; `menuQuantity` is in this unit. What was
   * marked follows the line's current unit.
   */
  menuUnit?: BuyableUnit
  /**
   * Menu items: the units this line can be bought in (PRO-292), the menu's
   * own first: the ones the ingredient converts to (density g↔ml, unit
   * weight or the shop's piece weight g↔u). Just the line's own unit when
   * nothing converts. Filled by `GET /shopping-list`.
   */
  unitOptions?: BuyableUnit[]
  /**
   * Menu or manual line whose name is one of the household's active staples
   * («Habitual», PRO-293): it comes back by itself on every new list. Staple
   * lines (`kind: 'staple'`) are habitual by kind. Filled by `GET /shopping-list`.
   */
  habitual?: boolean
  /**
   * Manual items: an amount in the household's own words («2 paquetes», «1
   * bote») when it isn't g / ml / u / cda / cdita (PRO-175). Shown instead of
   * `quantity` + `unit`.
   */
  amountText?: string
}

/** Lines that are still part of the list (not «No lo compro», PRO-175). */
export function activeShoppingItems<T extends { skipped?: boolean }>(items: readonly T[]): T[] {
  return items.filter((i) => !i.skipped)
}

/** What is still to buy of a line: its quantity minus what the household already has. */
export function missingQuantity(item: Pick<ShoppingItem, 'quantity' | 'haveQuantity'>): number {
  const have = item.haveQuantity ?? 0
  return have > 0 ? Math.max(0, item.quantity - have) : item.quantity
}

export interface ShoppingList {
  id: string
  userId: string
  menuId: string | null
  /** Inclusive ISO `YYYY-MM-DD` boundaries of the date range this list covers.
   *  Pre-migration rows have null — the route fills both on the next read. */
  rangeStartDate: string | null
  rangeEndDate: string | null
  items: ShoppingItem[]
  createdAt: Date
}
