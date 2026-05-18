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
}

export interface ShoppingList {
  id: string
  userId: string
  menuId: string | null
  items: ShoppingItem[]
  createdAt: Date
}
